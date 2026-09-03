const db = require('../../config/db');

const COLUMNS = [
  'id',
  'company_id',
  'vehicle_id',
  'driver_id',
  'transporting_vehicle_id',
  'transported_by_plate',
  'destination',
  'purpose',
  'departure_time',
  'departure_gate_id',
  'departure_operator_id',
  'return_time',
  'return_gate_id',
  'return_operator_id',
  'is_km_unavailable',
  'km_departure',
  'km_return',
  'fuel_level_departure',
  'fuel_level_return',
  'status',
  'observation',
  'created_at',
  'updated_at',
];

function baseQuery(companyId) {
  return db('fleet_logs').select(COLUMNS).where({ company_id: companyId }).whereNull('deleted_at');
}

function findByIdAndCompany(id, companyId) {
  return baseQuery(companyId).where({ id }).first();
}

function applyFilters(query, { status, vehicleId, from, to }) {
  if (status) query.andWhere({ status });
  if (vehicleId !== undefined) query.andWhere({ vehicle_id: vehicleId });
  if (from) query.andWhere('departure_time', '>=', from);
  if (to) query.andWhere('departure_time', '<=', to);
  return query;
}

function listByCompany(companyId, { limit, offset, status, vehicleId, from, to }) {
  const query = baseQuery(companyId).orderBy('departure_time', 'desc').limit(limit).offset(offset);
  return applyFilters(query, { status, vehicleId, from, to });
}

function countByCompany(companyId, { status, vehicleId, from, to }) {
  const query = db('fleet_logs').where({ company_id: companyId }).whereNull('deleted_at').count('id as count');
  return applyFilters(query, { status, vehicleId, from, to }).first();
}

// Casa com o predicado do índice parcial idx_fleet_logs_on_trip (company_id
// WHERE status = 'ON_TRIP').
function listOnTripByCompany(companyId) {
  return baseQuery(companyId).where({ status: 'ON_TRIP' }).orderBy('departure_time', 'asc');
}

async function insert(data) {
  const [row] = await db('fleet_logs').insert(data).returning(COLUMNS);
  return row;
}

async function update(id, companyId, data) {
  const [row] = await db('fleet_logs')
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
  listOnTripByCompany,
  insert,
  update,
};
