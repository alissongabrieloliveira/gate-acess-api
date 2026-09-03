const crypto = require('crypto');
const env = require('../config/env');

/**
 * Replica em Node a lógica de generate_bindex() do Postgres (gate_schema.sql):
 * normaliza o valor (minúsculas, só [0-9a-z]) e aplica HMAC-SHA256 com o mesmo
 * pepper configurado no banco (`app.bindex_pepper`). Mantido em Node para evitar
 * um round-trip ao banco só para calcular o hash de busca (ex.: localizar
 * usuário por e-mail no login).
 */
function generateBindex(value) {
  const clean = String(value).toLowerCase().replace(/[^0-9a-z]/g, '');
  return crypto.createHmac('sha256', env.bindexPepper).update(clean).digest('hex');
}

module.exports = { generateBindex };
