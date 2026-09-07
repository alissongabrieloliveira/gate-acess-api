const bcrypt = require('bcrypt');
const db = require('../../config/db');
const env = require('../../config/env');
const AppError = require('../../utils/AppError');
const repository = require('./auth.repository');
const { generateBindex } = require('../../utils/bindex');
const { comparePassword } = require('../../utils/password');
const { signAccessToken } = require('../../utils/jwt');
const { generateRefreshToken, hashRefreshToken } = require('../../utils/refreshToken');
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

module.exports = { login, refresh, logout };
