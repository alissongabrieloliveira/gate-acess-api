// Reexporta o knex singleton real da app (src/config/db.js) — a essa altura
// já está apontando pro banco de teste `portaria_test`, graças a
// tests/setupEnv.js (Jest `setupFiles`, roda antes de qualquer require deste
// arquivo). Evita abrir uma segunda pool de conexão só pros testes.
module.exports = require('../../src/config/db');
