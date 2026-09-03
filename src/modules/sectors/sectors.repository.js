const db = require('../../config/db');

const COLUMNS = ['id', 'company_id', 'name', 'description', 'is_active', 'created_at', 'updated_at'];

function baseQuery(companyId) {
  return db('sectors').select(COLUMNS).where({ company_id: companyId }).whereNull('deleted_at');
}

function findByIdAndCompany(id, companyId) {
  return baseQuery(companyId).where({ id }).first();
}

function listByCompany(companyId, { limit, offset, isActive }) {
  const query = baseQuery(companyId).orderBy('id', 'asc').limit(limit).offset(offset);
  if (isActive !== undefined) query.andWhere({ is_active: isActive });
  return query;
}

function countByCompany(companyId, { isActive }) {
  const query = db('sectors').where({ company_id: companyId }).whereNull('deleted_at').count('id as count');
  if (isActive !== undefined) query.andWhere({ is_active: isActive });
  return query.first();
}

async function insert(data) {
  const [row] = await db('sectors').insert(data).returning(COLUMNS);
  return row;
}

async function update(id, companyId, data) {
  const [row] = await db('sectors')
    .where({ id, company_id: companyId })
    .whereNull('deleted_at')
    .update(data)
    .returning(COLUMNS);
  return row;
}

module.exports = { findByIdAndCompany, listByCompany, countByCompany, insert, update };
