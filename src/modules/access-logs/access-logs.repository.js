const db = require('../../config/db');

const COLUMNS = [
  'id',
  'company_id',
  'person_id',
  'visited_person_id',
  'vehicle_id',
  'destination_sector_id',
  'is_km_unavailable',
  'km_entry',
  'km_exit',
  'visit_reason',
  'entry_time',
  'entry_gate_id',
  'entry_operator_id',
  'exit_time',
  'exit_gate_id',
  'exit_operator_id',
  'receipt_code',
  'signed_receipt_url',
  'status',
  'observation',
  'created_at',
  'updated_at',
];

function baseQuery(companyId) {
  return db('access_logs').select(COLUMNS).where({ company_id: companyId }).whereNull('deleted_at');
}

function findByIdAndCompany(id, companyId) {
  return baseQuery(companyId).where({ id }).first();
}

function applyFilters(query, { status, personId, from, to }) {
  if (status) query.andWhere({ status });
  if (personId !== undefined) query.andWhere({ person_id: personId });
  if (from) query.andWhere('entry_time', '>=', from);
  if (to) query.andWhere('entry_time', '<=', to);
  return query;
}

function listByCompany(companyId, { limit, offset, status, personId, from, to }) {
  const query = baseQuery(companyId).orderBy('entry_time', 'desc').limit(limit).offset(offset);
  return applyFilters(query, { status, personId, from, to });
}

function countByCompany(companyId, { status, personId, from, to }) {
  const query = db('access_logs').where({ company_id: companyId }).whereNull('deleted_at').count('id as count');
  return applyFilters(query, { status, personId, from, to }).first();
}

// Casa com o predicado do índice parcial idx_access_logs_active (company_id
// WHERE status = 'ACTIVE'), então o planner do Postgres consegue usá-lo.
function listActiveByCompany(companyId) {
  return baseQuery(companyId).where({ status: 'ACTIVE' }).orderBy('entry_time', 'asc');
}

// trx opcional (default: db): ver withAuthTransaction.
async function insert(data, trx = db) {
  const [row] = await trx('access_logs').insert(data).returning(COLUMNS);
  return row;
}

async function update(id, companyId, data, trx = db) {
  const [row] = await trx('access_logs')
    .where({ id, company_id: companyId })
    .whereNull('deleted_at')
    .update(data)
    .returning(COLUMNS);
  return row;
}

module.exports = {
  findByIdAndCompany,
  listByCompany,
  countByCompany,
  listActiveByCompany,
  insert,
  update,
};
