const { AsyncLocalStorage } = require('async_hooks');

/**
 * Empresa (tenant) da requisição em andamento, guardada no AsyncLocalStorage —
 * é daqui que config/db.js tira a claim `request.jwt.claims` que aplica em cada
 * conexão do pool antes de usá-la (claude.md seção 5.5). Com isso as leituras
 * também passam a rodar com a claim, não só as escritas do withAuthTransaction,
 * e as policies de RLS (migration 20261012130000) conseguem filtrar por empresa
 * quando a aplicação deixar de conectar como dona das tabelas.
 *
 * Só `company_id` vai na claim de conexão: as policies só olham a empresa, e
 * mudando só quando troca a empresa a conexão quase nunca precisa ser
 * reconfigurada. O `sub` (autor na auditoria) continua vindo do
 * withAuthTransaction, que sobrescreve a claim dentro da transação.
 */
const storage = new AsyncLocalStorage();

/**
 * Roda `fn` com a empresa informada como tenant (null = sem empresa).
 * As consultas precisam ser AGUARDADAS dentro de `fn` (`async () => await db(...)`):
 * o builder do knex só executa no `.then`, e um builder apenas retornado
 * executaria fora do contexto.
 */
function runWithTenant(companyId, fn) {
  return storage.run(companyId ? { companyId } : null, fn);
}

/** Valor da claim para a conexão: JSON com company_id, ou '' sem empresa. */
function currentTenantClaims() {
  const store = storage.getStore();
  return store?.companyId ? JSON.stringify({ company_id: store.companyId }) : '';
}

module.exports = { runWithTenant, currentTenantClaims };
