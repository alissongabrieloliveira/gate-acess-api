const db = require('../../config/db');

const COLUMNS = [
  'id',
  'company_id',
  'vehicle_type',
  'license_plate',
  'brand',
  'model',
  'color',
  'operation_status',
  'is_blocked',
  'block_reason',
  'photo_url',
  'created_at',
  'updated_at',
];

function baseQuery(companyId) {
  return db('vehicles').select(COLUMNS).where({ company_id: companyId }).whereNull('deleted_at');
}

function findByIdAndCompany(id, companyId) {
  return baseQuery(companyId).where({ id }).first();
}

function findByPlate(licensePlate, companyId) {
  return baseQuery(companyId).where({ license_plate: licensePlate }).first();
}

function listByCompany(companyId, { limit, offset, vehicleType, operationStatus }) {
  const query = baseQuery(companyId).orderBy('id', 'asc').limit(limit).offset(offset);
  if (vehicleType !== undefined) query.andWhere({ vehicle_type: vehicleType });
  if (operationStatus !== undefined) query.andWhere({ operation_status: operationStatus });
  return query;
}

function countByCompany(companyId, { vehicleType, operationStatus }) {
  const query = db('vehicles').where({ company_id: companyId }).whereNull('deleted_at').count('id as count');
  if (vehicleType !== undefined) query.andWhere({ vehicle_type: vehicleType });
  if (operationStatus !== undefined) query.andWhere({ operation_status: operationStatus });
  return query.first();
}

// trx opcional (default: db): ver withAuthTransaction — permite log_audit_event()
// saber quem fez a alteração.
async function insert(data, trx = db) {
  const [row] = await trx('vehicles').insert(data).returning(COLUMNS);
  return row;
}

async function update(id, companyId, data, trx = db) {
  const [row] = await trx('vehicles')
    .where({ id, company_id: companyId })
    .whereNull('deleted_at')
    .update(data)
    .returning(COLUMNS);
  return row;
}

module.exports = {
  findByIdAndCompany,
  findByPlate,
  listByCompany,
  countByCompany,
  insert,
  update,
};
