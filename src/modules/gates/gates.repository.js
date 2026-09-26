const db = require('../../config/db');

const COLUMNS = ['id', 'company_id', 'name', 'description', 'is_active', 'created_at', 'updated_at'];

function baseQuery(companyId) {
  return db('gates').select(COLUMNS).where({ company_id: companyId }).whereNull('deleted_at');
}

function findByIdAndCompany(id, companyId) {
  return baseQuery(companyId).where({ id }).first();
}

// Busca em lote pelos ids (sem LIMIT) pra montar o resumo exibido junto dos
// registros de acesso/frota. INCLUI soft-deletados: o histórico continua
// mostrando quem passou, mesmo se o cadastro foi removido depois. Sempre
// filtrado pela empresa.
function findByIdsIncludingDeleted(ids, companyId) {
  if (!ids.length) return Promise.resolve([]);
  return db('gates').select(COLUMNS).where({ company_id: companyId }).whereIn('id', ids);
}

// name/description ficam em claro no banco (sem criptografia) — dá pra
// fazer ILIKE direto, mesmo padrão já usado em vehicles.repository.js.
function applySearch(query, search) {
  if (!search) return query;
  const term = `%${search}%`;
  return query.andWhere((qb) => {
    qb.orWhereILike('name', term).orWhereILike('description', term);
  });
}

function listByCompany(companyId, { limit, offset, isActive, search }) {
  const query = baseQuery(companyId).orderBy('id', 'asc').limit(limit).offset(offset);
  if (isActive !== undefined) query.andWhere({ is_active: isActive });
  return applySearch(query, search);
}

function countByCompany(companyId, { isActive, search }) {
  const query = db('gates').where({ company_id: companyId }).whereNull('deleted_at').count('id as count');
  if (isActive !== undefined) query.andWhere({ is_active: isActive });
  return applySearch(query, search).first();
}

// trx opcional (default: db): ver withAuthTransaction.
async function insert(data, trx = db) {
  const [row] = await trx('gates').insert(data).returning(COLUMNS);
  return row;
}

async function update(id, companyId, data, trx = db) {
  const [row] = await trx('gates')
    .where({ id, company_id: companyId })
    .whereNull('deleted_at')
    .update(data)
    .returning(COLUMNS);
  return row;
}

module.exports = { findByIdAndCompany, findByIdsIncludingDeleted, listByCompany, countByCompany, insert, update };
