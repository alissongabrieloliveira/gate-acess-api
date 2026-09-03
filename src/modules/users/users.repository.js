const db = require('../../config/db');

const COLUMNS = [
  'id',
  'company_id',
  'name_encrypted',
  'cpf_encrypted',
  'email_encrypted',
  'rules',
  'is_active',
  'email_verified_at',
  'created_at',
  'updated_at',
];

function findByIdAndCompany(id, companyId) {
  return db('users').select(COLUMNS).where({ id, company_id: companyId }).whereNull('deleted_at').first();
}

function listByCompany(companyId, { limit, offset }) {
  return db('users')
    .select(COLUMNS)
    .where({ company_id: companyId })
    .whereNull('deleted_at')
    .orderBy('id', 'asc')
    .limit(limit)
    .offset(offset);
}

function countByCompany(companyId) {
  return db('users').where({ company_id: companyId }).whereNull('deleted_at').count('id as count').first();
}

async function insert(data) {
  const [row] = await db('users').insert(data).returning(COLUMNS);
  return row;
}

async function update(id, companyId, data) {
  const [row] = await db('users')
    .where({ id, company_id: companyId })
    .whereNull('deleted_at')
    .update(data)
    .returning(COLUMNS);
  return row;
}

function softDelete(id, companyId) {
  return db('users')
    .where({ id, company_id: companyId })
    .whereNull('deleted_at')
    .update({ deleted_at: db.fn.now(), is_active: false });
}

module.exports = {
  findByIdAndCompany,
  listByCompany,
  countByCompany,
  insert,
  update,
  softDelete,
};
