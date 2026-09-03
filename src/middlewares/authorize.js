/** Verifica um bit de permissão no bitmask req.auth.rules. Usar após authenticate. */
function authorize(requiredBit) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    if ((req.auth.rules & requiredBit) !== requiredBit) {
      return res.status(403).json({ error: 'Permissão insuficiente' });
    }

    return next();
  };
}

module.exports = authorize;
