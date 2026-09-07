const bcrypt = require('bcrypt');
const db = require('../../config/db');
const env = require('../../config/env');
const AppError = require('../../utils/AppError');
const repository = require('./auth.repository');
const { generateBindex } = require('../../utils/bindex');
const { comparePassword, hashPassword } = require('../../utils/password');
const { signAccessToken } = require('../../utils/jwt');
// generateResetToken/hashResetToken são os mesmos generateRefreshToken/
// hashRefreshToken, só com alias local — a necessidade (opaco, alta
// entropia, só o hash é persistido) é idêntica pro token de recuperação de
// senha, então reaproveita em vez de duplicar a lógica num util novo.
const {
  generateRefreshToken,
  hashRefreshToken,
  generateRefreshToken: generateResetToken,
  hashRefreshToken: hashResetToken,
} = require('../../utils/refreshToken');
const { sendPasswordResetEmail } = require('../../utils/email');
const parseDuration = require('../../utils/parseDuration');

// Hash bcrypt de uma senha fixa qualquer, calculado uma única vez no início. Usado só
// para equalizar o tempo de resposta quando o e-mail não existe — sem isso, a ausência
// da chamada a bcrypt.compare tornaria a resposta perceptivelmente mais rápida,
// permitindo enumerar e-mails cadastrados pelo tempo de resposta do login.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-used-for-timing-safety', 12);

function refreshExpiresAt() {
  return new Date(Date.now() + parseDuration(env.refreshTokenExpiresIn));
}

async function login({ email, password, ipAddress, userAgent }) {
  const emailBindex = generateBindex(email);
  const user = await repository.findUserByEmailBindex(emailBindex);

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw new AppError('Credenciais inválidas', 401);
  }

  const passwordMatches = await comparePassword(password, user.password_hash);

  if (!passwordMatches || !user.is_active) {
    await repository.createLoginLog({
      companyId: user.company_id,
      userId: user.id,
      ipAddress,
      userAgent,
      status: 'FAILED',
    });
    throw new AppError('Credenciais inválidas', 401);
  }

  const accessToken = signAccessToken({
    userId: user.id,
    companyId: user.company_id,
    rules: user.rules,
    mustChangePassword: user.must_change_password,
  });
  const { raw: refreshTokenRaw, hash: refreshTokenHash } = generateRefreshToken();
  const expiresAt = refreshExpiresAt();

  await repository.insertRefreshToken({
    companyId: user.company_id,
    userId: user.id,
    tokenHash: refreshTokenHash,
    expiresAt,
    ipAddress,
    userAgent,
  });

  await repository.createLoginLog({
    companyId: user.company_id,
    userId: user.id,
    ipAddress,
    userAgent,
    status: 'SUCCESS',
  });

  return { accessToken, refreshTokenRaw, refreshExpiresAt: expiresAt };
}

async function refresh({ refreshTokenRaw, ipAddress, userAgent }) {
  if (!refreshTokenRaw) {
    throw new AppError('Refresh token ausente', 401);
  }

  const tokenHash = hashRefreshToken(refreshTokenRaw);
  const record = await repository.findRefreshTokenByHash(tokenHash);

  if (!record) {
    throw new AppError('Refresh token inválido', 401);
  }

  if (record.revoked_at) {
    // Reuso de um token já rotacionado/revogado é sinal de possível roubo de token
    // (replaced_by_id detecta isso). Contenção: revoga todas as sessões do usuário.
    await repository.revokeAllUserRefreshTokens(record.user_id);
    throw new AppError('Refresh token já utilizado — todas as sessões foram revogadas', 401);
  }

  if (new Date(record.expires_at) < new Date()) {
    throw new AppError('Refresh token expirado', 401);
  }

  const user = await repository.findActiveUserById(record.user_id);
  if (!user || !user.is_active) {
    await repository.revokeRefreshToken(record.id);
    throw new AppError('Usuário inativo ou não encontrado', 401);
  }

  const { raw: newRefreshTokenRaw, hash: newRefreshTokenHash } = generateRefreshToken();
  const expiresAt = refreshExpiresAt();

  await db.transaction(async (trx) => {
    const newTokenId = await repository.insertRefreshToken(
      {
        companyId: user.company_id,
        userId: user.id,
        tokenHash: newRefreshTokenHash,
        expiresAt,
        ipAddress,
        userAgent,
      },
      trx
    );
    await repository.setReplacedBy(record.id, newTokenId, trx);
    await repository.revokeRefreshToken(record.id, trx);
  });

  const accessToken = signAccessToken({
    userId: user.id,
    companyId: user.company_id,
    rules: user.rules,
    mustChangePassword: user.must_change_password,
  });

  return { accessToken, refreshTokenRaw: newRefreshTokenRaw, refreshExpiresAt: expiresAt };
}

async function logout({ refreshTokenRaw }) {
  if (!refreshTokenRaw) return;

  const tokenHash = hashRefreshToken(refreshTokenRaw);
  const record = await repository.findRefreshTokenByHash(tokenHash);

  if (record && !record.revoked_at) {
    await repository.revokeRefreshToken(record.id);
  }
}

function passwordResetExpiresAt() {
  return new Date(Date.now() + parseDuration(env.passwordResetExpiresIn));
}

// Sempre resolve sem erro pro chamador, exista ou não a conta — o
// controller responde a mesma coisa nos dois casos (mesmo princípio
// anti-enumeração do login: nunca revelar se um e-mail está cadastrado).
async function forgotPassword({ email }) {
  const emailBindex = generateBindex(email);
  const user = await repository.findUserByEmailBindex(emailBindex);

  if (!user || !user.is_active) return;

  const { raw, hash } = generateResetToken();
  await repository.insertPasswordResetToken({
    companyId: user.company_id,
    userId: user.id,
    tokenHash: hash,
    expiresAt: passwordResetExpiresAt(),
  });

  // corsOrigin já É a origem do frontend (mesma variável usada pra
  // configurar o CORS) — sem precisar de uma env var nova só pra isso.
  const resetUrl = `${env.corsOrigin}/reset-password?token=${raw}`;
  await sendPasswordResetEmail({ to: email, resetUrl });
}

async function resetPassword({ token, password }) {
  if (!token || !password) {
    throw new AppError('Token e nova senha são obrigatórios', 400);
  }

  const tokenHash = hashResetToken(token);
  const record = await repository.findPasswordResetTokenByHash(tokenHash);

  // Mensagem genérica de propósito (não diferencia "não existe" de
  // "expirado" de "já usado") — não há motivo pra dar essa granularidade
  // pra quem só tem um token, válido ou não, na mão.
  if (!record || record.used_at || new Date(record.expires_at) < new Date()) {
    throw new AppError('Link de recuperação inválido ou expirado', 400);
  }

  const passwordHash = await hashPassword(password);

  await db.transaction(async (trx) => {
    await repository.updateUserPassword(record.user_id, passwordHash, trx);
    await repository.markPasswordResetTokenUsed(record.id, trx);
    // Mesmo tratamento de segurança da detecção de reuso de refresh token:
    // se alguém mais tinha sessão aberta na conta, perde o acesso.
    await repository.revokeAllUserRefreshTokens(record.user_id, trx);
  });
}

module.exports = { login, refresh, logout, forgotPassword, resetPassword };
