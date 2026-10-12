const knex = require('knex');
const PgClient = require('knex/lib/dialects/postgres');
const knexConfig = require('../../knexfile');
const { currentTenantClaims } = require('../utils/tenantContext');

/**
 * Cliente pg do knex que, ao tirar uma conexão do pool, aplica nela a claim do
 * tenant da requisição atual (utils/tenantContext.js) com
 * set_config('request.jwt.claims', ..., false) — vale para a conexão até a
 * próxima troca. A conexão guarda a última claim aplicada e só repete o
 * set_config quando a empresa muda, então o custo normal é zero.
 *
 * Escopo de sessão (não `true`/local) porque as leituras não abrem transação.
 * Isso exige que a conexão com o Postgres seja direta ou pelo pooler do
 * Supabase em modo SESSÃO (porta 5432, o que produção usa). No modo transação
 * (porta 6543) cada comando pode cair numa conexão diferente do servidor.
 *
 * Dentro do withAuthTransaction a claim é sobrescrita com `sub` só para a
 * transação (set_config local) e volta ao valor da conexão no fim dela.
 */
class TenantAwarePgClient extends PgClient {
  async acquireConnection() {
    const connection = await super.acquireConnection();
    const claims = currentTenantClaims();
    if (connection.__tenantClaims !== claims) {
      try {
        await connection.query(`SELECT set_config('request.jwt.claims', $1, false)`, [claims]);
        connection.__tenantClaims = claims;
      } catch (err) {
        await this.releaseConnection(connection);
        throw err;
      }
    }
    return connection;
  }
}

const db = knex({ ...knexConfig, client: TenantAwarePgClient });

module.exports = db;
