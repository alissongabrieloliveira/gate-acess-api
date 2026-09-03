const db = require('../../config/db');

const COLUMNS = [
  'id',
  'company_id',
  'person_type',
  'name_encrypted',
  'cpf_encrypted',
  'rg_encrypted',
  'phone_encrypted',
  'photo_url',
  'is_blocked',
  'block_reason',
  'created_at',
  'updated_at',
];

function baseQuery(companyId) {
  return db('people').select(COLUMNS).where({ company_id: companyId }).whereNull('deleted_at');
}

function findByIdAndCompany(id, companyId) {
  return baseQuery(companyId).where({ id }).first();
}

function findByCpfBindex(cpfBindex, companyId) {
  return baseQuery(companyId).where({ cpf_bindex: cpfBindex }).first();
}

function listByCompany(companyId, { limit, offset, personType }) {
  const query = baseQuery(companyId).orderBy('id', 'asc').limit(limit).offset(offset);
  if (personType !== undefined) query.andWhere({ person_type: personType });
  return query;
}

function countByCompany(companyId, { personType }) {
  const query = db('people').where({ company_id: companyId }).whereNull('deleted_at').count('id as count');
  if (personType !== undefined) query.andWhere({ person_type: personType });
  return query.first();
}

async function insert(data) {
  const [row] = await db('people').insert(data).returning(COLUMNS);
  return row;
}

async function update(id, companyId, data) {
  const [row] = await db('people')
    .where({ id, company_id: companyId })
    .whereNull('deleted_at')
    .update(data)
    .returning(COLUMNS);
  return row;
}

module.exports = {
  findByIdAndCompany,
  findByCpfBindex,
  listByCompany,
  countByCompany,
  insert,
  update,
};
