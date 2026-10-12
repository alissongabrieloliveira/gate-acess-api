const { verifyAccessToken } = require('../utils/jwt');
const { runWithTenant } = require('../utils/tenantContext');

/**
 * Valida o access token (Bearer) e popula req.auth = { userId, companyId, rules }.
 * O resto da requisição roda com a empresa do token como tenant — toda consulta
 * ao banco leva a claim (utils/tenantContext.js, config/db.js).
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Token de acesso ausente' });
  }

  try {
    const payload = verifyAccessToken(token);
    req.auth = {
      userId: payload.sub,
      companyId: payload.company_id,
      rules: payload.rules,
      mustChangePassword: Boolean(payload.must_change_password),
      privacyNoticePending: Boolean(payload.privacy_notice_pending),
    };
  } catch (err) {
    return res.status(401).json({ error: 'Token de acesso inválido ou expirado' });
  }
  return runWithTenant(req.auth.companyId, next);
}

module.exports = authenticate;
