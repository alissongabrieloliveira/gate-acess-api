const db = require('../config/db');
const { hashGatewayToken } = require('../utils/gatewayToken');

/** Resolve um gateway_devices ativo (não revogado) a partir do token bruto apresentado no handshake WS. */
async function authenticateGatewayToken(rawToken) {
  if (!rawToken) return null;
  const tokenHash = hashGatewayToken(rawToken);
  const device = await db('gateway_devices')
    .select('id', 'company_id', 'name')
    .where({ token_hash: tokenHash })
    .whereNull('revoked_at')
    .first();
  return device || null;
}

module.exports = { authenticateGatewayToken };
