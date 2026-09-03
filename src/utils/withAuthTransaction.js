const db = require('../config/db');

/**
 * Abre uma transação Knex e configura request.jwt.claims para esta transação —
 * é o que faz log_audit_event() (gate_schema.sql) conseguir identificar quem fez
 * cada alteração (claude.md seção 5.5). Sem isso, audit_logs.user_id fica sempre
 * NULL em tudo que a API escreve.
 *
 * AJUSTE em relação ao snippet do claude.md: `SET LOCAL x = ?` não aceita bind
 * parameter — é uma restrição da gramática do comando SET no Postgres (testado:
 * "syntax error at or near "$1""). set_config('request.jwt.claims', valor, true)
 * é uma function call normal, então aceita parâmetro; o terceiro argumento `true`
 * (is_local) reproduz o mesmo escopo do SET LOCAL — vale só para esta transação,
 * não vaza para outras conexões do pool.
 */
async function withAuthTransaction(auth, callback) {
  return db.transaction(async (trx) => {
    await trx.raw(`SELECT set_config('request.jwt.claims', ?, true)`, [
      JSON.stringify({ sub: auth.userId, company_id: auth.companyId }),
    ]);
    return callback(trx);
  });
}

module.exports = withAuthTransaction;
