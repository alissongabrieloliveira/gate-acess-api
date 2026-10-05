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
  'visit_reason_encrypted',
  'entry_time',
  'entry_gate_id',
  'entry_operator_id',
  'exit_time',
  'exit_gate_id',
  'exit_operator_id',
  'receipt_code',
  'signed_receipt_url',
  'photo_url',
  'status',
  'observation_encrypted',
  'created_at',
  'updated_at',
];

function baseQuery(companyId) {
  return db('access_logs').select(COLUMNS).where({ company_id: companyId }).whereNull('deleted_at');
}

function findByIdAndCompany(id, companyId) {
  return baseQuery(companyId).where({ id }).first();
}

// personIds/vehicleIds vêm de access-logs.service.js (resolvidos via
// peopleService.searchIds/vehiclesService.searchIds a partir de ?search=) —
// casam em OR entre si (a pessoa OU o veículo bate com o termo buscado), mas
// em AND com os demais filtros. Só entram na query quando o array tem pelo
// menos um id (o service já resolve o caso de busca sem nenhum match antes
// de chegar aqui, retornando vazio sem nem consultar o banco).
function applyFilters(query, { status, personId, entryGateId, from, to, personIds, vehicleIds }) {
  if (status) query.andWhere({ status });
  if (personId !== undefined) query.andWhere({ person_id: personId });
  if (entryGateId !== undefined) query.andWhere({ entry_gate_id: entryGateId });
  if (from) query.andWhere('entry_time', '>=', from);
  if (to) query.andWhere('entry_time', '<=', to);
  if (personIds?.length || vehicleIds?.length) {
    query.andWhere((qb) => {
      if (personIds?.length) qb.orWhereIn('person_id', personIds);
      if (vehicleIds?.length) qb.orWhereIn('vehicle_id', vehicleIds);
    });
  }
  return query;
}

function listByCompany(companyId, { limit, offset, status, personId, entryGateId, from, to, personIds, vehicleIds }) {
  const query = baseQuery(companyId).orderBy('entry_time', 'desc').limit(limit).offset(offset);
  return applyFilters(query, { status, personId, entryGateId, from, to, personIds, vehicleIds });
}

function countByCompany(companyId, { status, personId, entryGateId, from, to, personIds, vehicleIds }) {
  const query = db('access_logs').where({ company_id: companyId }).whereNull('deleted_at').count('id as count');
  return applyFilters(query, { status, personId, entryGateId, from, to, personIds, vehicleIds }).first();
}

// Exportação de dados do titular (LGPD): todos os registros em que a pessoa
// aparece numa coluna (person_id = visitante, visited_person_id = anfitrião).
function listAllByPersonColumn(companyId, column, personId) {
  return baseQuery(companyId).where(column, personId).orderBy('entry_time', 'desc');
}

// Casa com o predicado do índice parcial idx_access_logs_active (company_id
// WHERE status = 'ACTIVE'), então o planner do Postgres consegue usá-lo.
function listActiveByCompany(companyId) {
  return baseQuery(companyId).where({ status: 'ACTIVE' }).orderBy('entry_time', 'asc');
}

// Entrada em aberto da pessoa / do veículo (no máximo uma de cada —
// idx_access_logs_person_active / idx_access_logs_vehicle_active).
// excludeId: o próprio registro, na edição.
function findActiveByColumn(companyId, column, value, excludeId) {
  const query = baseQuery(companyId).where({ [column]: value, status: 'ACTIVE' });
  if (excludeId !== undefined) query.whereNot({ id: excludeId });
  return query.first();
}

function findActiveByPerson(companyId, personId, excludeId) {
  return findActiveByColumn(companyId, 'person_id', personId, excludeId);
}

function findActiveByVehicle(companyId, vehicleId, excludeId) {
  return findActiveByColumn(companyId, 'vehicle_id', vehicleId, excludeId);
}

// Acesso mais recente do veículo com algum KM registrado; COALESCE porque a
// saída (quando existe) é sempre a leitura mais nova do odômetro.
function findLastKnownKm(companyId, vehicleId) {
  return db('access_logs')
    .where({ company_id: companyId, vehicle_id: vehicleId })
    .whereNull('deleted_at')
    .andWhere((qb) => qb.whereNotNull('km_exit').orWhereNotNull('km_entry'))
    .orderBy([
      { column: 'entry_time', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .select(db.raw('COALESCE(km_exit, km_entry) AS km'))
    .first();
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
  listAllByPersonColumn,
  findByIdAndCompany,
  listByCompany,
  countByCompany,
  listActiveByCompany,
  findActiveByPerson,
  findActiveByVehicle,
  findLastKnownKm,
  insert,
  update,
};
