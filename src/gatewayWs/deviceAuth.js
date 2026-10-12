const db = require('../config/db');
const { hashGatewayToken } = require('../utils/gatewayToken');
const { runWithTenant } = require('../utils/tenantContext');

/**
 * Resolve um gateway_devices ativo (não revogado) a partir do token bruto apresentado no handshake WS.
 * O handshake não tem empresa no contexto: a função de banco
 * app_private.company_id_for_gateway_token (migration 20261012140000) diz a
 * empresa do token, e a busca do device roda dentro dela.
 */
async function authenticateGatewayToken(rawToken) {
  if (!rawToken) return null;
  const tokenHash = hashGatewayToken(rawToken);
  const result = await db.raw('SELECT app_private.company_id_for_gateway_token(?) AS company_id', [tokenHash]);
  const companyId = result.rows[0]?.company_id ?? null;
  if (!companyId) return null;

  const device = await runWithTenant(companyId, async () =>
    await db('gateway_devices')
      .select('id', 'company_id', 'name')
      .where({ token_hash: tokenHash })
      .whereNull('revoked_at')
      .first()
  );
  return device || null;
}

module.exports = { authenticateGatewayToken };
