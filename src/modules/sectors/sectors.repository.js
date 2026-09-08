const db = require('../../config/db');

const COLUMNS = ['id', 'company_id', 'name', 'description', 'is_active', 'created_at', 'updated_at'];

function baseQuery(companyId) {
  return db('sectors').select(COLUMNS).where({ company_id: companyId }).whereNull('deleted_at');
}

function findByIdAndCompany(id, companyId) {
  return baseQuery(companyId).where({ id }).first();
}

// name/description ficam em claro no banco (sem criptografia) — dá pra
// fazer ILIKE direto, mesmo padrão já usado em gates.repository.js.
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
  const query = db('sectors').where({ company_id: companyId }).whereNull('deleted_at').count('id as count');
  if (isActive !== undefined) query.andWhere({ is_active: isActive });
  return applySearch(query, search).first();
}

// trx opcional (default: db): ver withAuthTransaction.
async function insert(data, trx = db) {
  const [row] = await trx('sectors').insert(data).returning(COLUMNS);
  return row;
}

async function update(id, companyId, data, trx = db) {
  const [row] = await trx('sectors')
    .where({ id, company_id: companyId })
    .whereNull('deleted_at')
    .update(data)
    .returning(COLUMNS);
  return row;
}

module.exports = { findByIdAndCompany, listByCompany, countByCompany, insert, update };
