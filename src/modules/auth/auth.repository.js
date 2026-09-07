const db = require('../../config/db');

/** Busca usuário ativo (não soft-deletado) pelo blind index do e-mail. */
function findUserByEmailBindex(emailBindex) {
  return db('users')
    .select('id', 'company_id', 'password_hash', 'rules', 'is_active', 'must_change_password')
    .where({ email_bindex: emailBindex })
    .whereNull('deleted_at')
    .first();
}

/** Busca usuário ativo (não soft-deletado) por id — usado para revalidar no refresh. */
function findActiveUserById(id) {
  return db('users')
    .select('id', 'company_id', 'rules', 'is_active', 'must_change_password')
    .where({ id })
    .whereNull('deleted_at')
    .first();
}

function createLoginLog({ companyId, userId, ipAddress, userAgent, status }, trx = db) {
  return trx('login_logs').insert({
    company_id: companyId,
    user_id: userId,
    ip_address: ipAddress,
    user_agent: userAgent,
    status,
  });
}

async function insertRefreshToken(
  { companyId, userId, tokenHash, expiresAt, ipAddress, userAgent },
  trx = db
) {
  const rows = await trx('refresh_tokens')
    .insert({
      company_id: companyId,
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      ip_address: ipAddress,
      user_agent: userAgent,
    })
    .returning('id');

  return rows[0].id;
}

function findRefreshTokenByHash(tokenHash, trx = db) {
  return trx('refresh_tokens').where({ token_hash: tokenHash }).first();
}

function revokeRefreshToken(id, trx = db) {
  return trx('refresh_tokens').where({ id }).update({ revoked_at: trx.fn.now() });
}

function revokeAllUserRefreshTokens(userId, trx = db) {
  return trx('refresh_tokens')
    .where({ user_id: userId })
    .whereNull('revoked_at')
    .update({ revoked_at: trx.fn.now() });
}

function setReplacedBy(oldId, newId, trx = db) {
  return trx('refresh_tokens').where({ id: oldId }).update({ replaced_by_id: newId });
}

module.exports = {
  findUserByEmailBindex,
  findActiveUserById,
  createLoginLog,
  insertRefreshToken,
  findRefreshTokenByHash,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
  setReplacedBy,
};
