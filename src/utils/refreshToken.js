const crypto = require('crypto');

/**
 * Refresh token opaco (não é um JWT): alta entropia (48 bytes aleatórios) em vez de
 * um token assinado, conforme gate_schema.sql/refresh_tokens — "SHA-256 é suficiente
 * aqui, pois o token tem alta entropia (diferente do caso do CPF)". Só o hash é
 * persistido; o valor bruto só existe no cookie do cliente.
 */
function generateRefreshToken() {
  const raw = crypto.randomBytes(48).toString('base64url');
  return { raw, hash: hashRefreshToken(raw) };
}

function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = { generateRefreshToken, hashRefreshToken };
