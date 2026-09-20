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

// driverIds/vehicleIds/destinationTerm vêm de fleet-logs.service.js
// (?search=, "placa, motorista ou destino") — casam em OR entre si, mas em
// AND com os demais filtros. destination é a única coluna de texto livre
// nesta tabela (as outras duas buscas passam por people/vehicles), então
// sempre entra como ILIKE quando há termo buscado, mesmo que nenhuma
// pessoa/veículo tenha batido.
function applyFilters(query, { status, vehicleId, from, to, driverIds, vehicleIds, destinationTerm }) {
  if (status) query.andWhere({ status });
  if (vehicleId !== undefined) query.andWhere({ vehicle_id: vehicleId });
  if (from) query.andWhere('departure_time', '>=', from);
  if (to) query.andWhere('departure_time', '<=', to);
  if (driverIds?.length || vehicleIds?.length || destinationTerm) {
    query.andWhere((qb) => {
      if (driverIds?.length) qb.orWhereIn('driver_id', driverIds);
      if (vehicleIds?.length) qb.orWhereIn('vehicle_id', vehicleIds);
      if (destinationTerm) qb.orWhereILike('destination', `%${destinationTerm}%`);
    });
  }
  return query;
}

function listByCompany(companyId, { limit, offset, status, vehicleId, from, to, driverIds, vehicleIds, destinationTerm }) {
  const query = baseQuery(companyId).orderBy('departure_time', 'desc').limit(limit).offset(offset);
  return applyFilters(query, { status, vehicleId, from, to, driverIds, vehicleIds, destinationTerm });
}

function countByCompany(companyId, { status, vehicleId, from, to, driverIds, vehicleIds, destinationTerm }) {
  const query = db('fleet_logs').where({ company_id: companyId }).whereNull('deleted_at').count('id as count');
  return applyFilters(query, { status, vehicleId, from, to, driverIds, vehicleIds, destinationTerm }).first();
}

// Casa com o predicado do índice parcial idx_fleet_logs_on_trip (company_id
// WHERE status = 'ON_TRIP').
function listOnTripByCompany(companyId) {
  return baseQuery(companyId).where({ status: 'ON_TRIP' }).orderBy('departure_time', 'asc');
}

// Log mais recente do veículo que tenha algum KM registrado; COALESCE porque
// o retorno (quando existe) é sempre a leitura mais nova do odômetro.
function findLastKnownKm(companyId, vehicleId) {
  return db('fleet_logs')
    .where({ company_id: companyId, vehicle_id: vehicleId })
    .whereNull('deleted_at')
    .andWhere((qb) => qb.whereNotNull('km_return').orWhereNotNull('km_departure'))
    .orderBy([
      { column: 'departure_time', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .select(db.raw('COALESCE(km_return, km_departure) AS km'))
    .first();
}

// trx opcional (default: db): ver withAuthTransaction.
async function insert(data, trx = db) {
  const [row] = await trx('fleet_logs').insert(data).returning(COLUMNS);
  return row;
}

async function update(id, companyId, data, trx = db) {
  const [row] = await trx('fleet_logs')
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
  findLastKnownKm,
  insert,
  update,
};
