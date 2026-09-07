const { verifyAccessToken } = require('../utils/jwt');

/** Valida o access token (Bearer) e popula req.auth = { userId, companyId, rules }. */
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
    };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Token de acesso inválido ou expirado' });
  }
}

module.exports = authenticate;
