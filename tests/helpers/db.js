// Conexão dos TESTES com o banco `portaria_test`, como DONO das tabelas
// (MIGRATION_DATABASE_URL de .env.test): factories e conferências diretas no
// banco enxergam e gravam tudo, sem passar pelo RLS. A API sob teste usa a
// própria conexão (src/config/db.js), com o papel app_runtime — sujeita às
// policies, como em produção. Essa outra pool é fechada por
// tests/closeAppDb.js depois de cada arquivo de teste.
const knex = require('knex');
const knexConfig = require('../../knexfile');

module.exports = knex(knexConfig);
