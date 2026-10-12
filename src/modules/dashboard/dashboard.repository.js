const db = require('../../config/db');

function countBlocked(table, companyId) {
  return db(table)
    .where({ company_id: companyId, is_blocked: true })
    .whereNull('deleted_at')
    .count('id as count')
    .first();
}

function countPeopleCreatedSince(companyId, from) {
  return db('people')
    .where({ company_id: companyId })
    .whereNull('deleted_at')
    .andWhere('created_at', '>=', from)
    .count('id as count')
    .first();
}

// Agrupa pelo dia no fuso do operador (não em UTC): um acesso às 22h de
// Brasília é do mesmo dia pra quem olha a tela, mesmo já sendo o dia
// seguinte em UTC.
function countAccessesByDayAndGate(companyId, from, timeZone) {
  return db('access_logs')
    .select(db.raw(`to_char(entry_time AT TIME ZONE ?, 'YYYY-MM-DD') AS day`, [timeZone]), 'entry_gate_id')
    .count('id as count')
    .where({ company_id: companyId })
    .whereNull('deleted_at')
    .andWhere('entry_time', '>=', from)
    .groupBy('day', 'entry_gate_id')
    .orderBy('day');
}

// Alertas (GET /dashboard/alerts). Os dois primeiros usam os índices
// parciais de "em aberto" (idx_access_logs_active / idx_fleet_logs_on_trip).
function listActiveAccessesEnteredBefore(companyId, before) {
  return db('access_logs')
    .select('id', 'person_id', 'vehicle_id', 'entry_time', 'entry_gate_id')
    .where({ company_id: companyId, status: 'ACTIVE' })
    .whereNull('deleted_at')
    .andWhere('entry_time', '<', before)
    .orderBy('entry_time', 'asc');
}

function listOnTripDepartedBefore(companyId, before) {
  return db('fleet_logs')
    .select('id', 'vehicle_id', 'driver_id', 'transport_log_id', 'destination', 'departure_time')
    .where({ company_id: companyId, status: 'ON_TRIP' })
    .whereNull('deleted_at')
    .andWhere('departure_time', '<', before)
    .orderBy('departure_time', 'asc');
}

// Passagens lançadas como retroativas desde `since` — pela hora REAL do
// lançamento (created_at da entrada/saída da frota, *_recorded_at da
// saída/retorno), não pela hora informada.
function listRecentRetroactiveAccesses(companyId, since) {
  return db('access_logs')
    .select(
      'id',
      'person_id',
      'vehicle_id',
      'entry_time',
      'exit_time',
      'entry_operator_id',
      'exit_operator_id',
      'entry_retroactive_reason_encrypted',
      'exit_retroactive_reason_encrypted',
      'created_at',
      'exit_recorded_at'
    )
    .where({ company_id: companyId })
    .whereNull('deleted_at')
    .andWhere((qb) =>
      qb
        .where((q) => q.whereNotNull('entry_retroactive_reason_encrypted').andWhere('created_at', '>=', since))
        .orWhere((q) => q.whereNotNull('exit_retroactive_reason_encrypted').andWhere('exit_recorded_at', '>=', since))
    );
}

function listRecentRetroactiveFleetLogs(companyId, since) {
  return db('fleet_logs')
    .select(
      'id',
      'vehicle_id',
      'driver_id',
      'departure_time',
      'return_time',
      'departure_operator_id',
      'return_operator_id',
      'departure_retroactive_reason_encrypted',
      'return_retroactive_reason_encrypted',
      'created_at',
      'return_recorded_at'
    )
    .where({ company_id: companyId })
    .whereNull('deleted_at')
    .andWhere((qb) =>
      qb
        .where((q) => q.whereNotNull('departure_retroactive_reason_encrypted').andWhere('created_at', '>=', since))
        .orWhere((q) => q.whereNotNull('return_retroactive_reason_encrypted').andWhere('return_recorded_at', '>=', since))
    );
}

function findActiveGatewayDevice(companyId) {
  return db('gateway_devices')
    .select('id', 'name', 'last_seen_at')
    .where({ company_id: companyId })
    .whereNull('revoked_at')
    .first();
}

// Inclui removidos: quem lançou continua sendo mostrado.
function findUsersByIds(companyId, ids) {
  if (!ids.length) return [];
  return db('users').select('id', 'name_encrypted').where({ company_id: companyId }).whereIn('id', ids);
}

module.exports = {
  countBlocked,
  countPeopleCreatedSince,
  countAccessesByDayAndGate,
  listActiveAccessesEnteredBefore,
  listOnTripDepartedBefore,
  listRecentRetroactiveAccesses,
  listRecentRetroactiveFleetLogs,
  findActiveGatewayDevice,
  findUsersByIds,
};
