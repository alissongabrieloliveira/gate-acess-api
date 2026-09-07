// Jest `globalSetup`: roda UMA vez, num processo próprio, antes de qualquer
// arquivo de teste. Não compartilha `process.env` com os workers de teste
// (por isso tests/setupEnv.js também carrega o mesmo .env.test, separadamente,
// dentro de cada arquivo).
//
// Cria (se não existir) e migra o banco de teste dedicado `portaria_test`, no
// mesmo Postgres dev (container `portaria-db`) — reaproveita a infra já
// existente em vez de subir um container novo ou mockar o banco. Depois
// trunca todas as tabelas de negócio (menos `cities`, que é dado global
// compartilhado, sem custo de recriar) pra garantir um baseline limpo a cada
// execução — sem se preocupar em limpar entre testes individuais dentro da
// mesma execução (mesma tolerância a resíduo já usada no banco de dev deste
// projeto).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });

const { Client } = require('pg');

const TEST_DB_NAME = 'portaria_test';

// Tabelas de negócio, na ordem que respeita FKs via CASCADE (a ordem exata não
// importa com CASCADE, mas RESTART IDENTITY reseta os SERIAL de cada uma).
const BUSINESS_TABLES = [
  'refresh_tokens',
  'login_logs',
  'audit_logs',
  'access_logs',
  'fleet_logs',
  'sectors',
  'gates',
  'vehicles',
  'people',
  'users',
  'companies',
];

function maintenanceConnectionString(databaseUrl) {
  const url = new URL(databaseUrl);
  url.pathname = '/postgres';
  return url.toString();
}

async function ensureTestDatabaseExists(databaseUrl) {
  const client = new Client({ connectionString: maintenanceConnectionString(databaseUrl) });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } catch (err) {
    // 42P04 = duplicate_database — já existe, segue o jogo.
    if (err.code !== '42P04') throw err;
  } finally {
    await client.end();
  }
}

module.exports = async function globalSetup() {
  await ensureTestDatabaseExists(process.env.DATABASE_URL);

  // knexfile.js lê DATABASE_URL do process.env no momento em que é exigido —
  // já está apontando pro portaria_test graças ao dotenv.config() no topo
  // deste arquivo.
  const knexConfig = require('../knexfile');
  const knex = require('knex')(knexConfig);

  try {
    await knex.migrate.latest();
    await knex.raw(`TRUNCATE TABLE ${BUSINESS_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  } finally {
    await knex.destroy();
  }
};
