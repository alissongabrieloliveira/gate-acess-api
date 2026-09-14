const crypto = require('crypto');

/**
 * Token de autenticação do gateway local (dispositivo, não usuário humano) —
 * mesmo padrão de refreshToken.js: alta entropia, só o hash (SHA-256) é
 * persistido em gateway_devices.token_hash, o valor bruto só existe uma vez,
 * no momento do provisionamento (ver seeds/002_gateway_provisioning.js).
 */
function generateGatewayToken() {
  const raw = crypto.randomBytes(32).toString('base64url');
  return { raw, hash: hashGatewayToken(raw) };
}

function hashGatewayToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = { generateGatewayToken, hashGatewayToken };
