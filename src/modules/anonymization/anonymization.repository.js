// Todas as funções recebem a transação (withAuthTransaction) do service: a
// anonimização é tudo-ou-nada.

const VEHICLE_TYPE_FLEET = 2;

function findPerson(trx, companyId, personId) {
  return trx('people')
    .select('id', 'is_blocked', 'photo_url', 'anonymized_at')
    .where({ id: personId, company_id: companyId })
    .whereNull('deleted_at')
    .first();
}

async function countOpenRecords(trx, companyId, personId) {
  const [inside, onTrip] = await Promise.all([
    trx('access_logs')
      .where({ company_id: companyId, person_id: personId, status: 'ACTIVE' })
      .whereNull('deleted_at')
      .count('id as count')
      .first(),
    trx('fleet_logs')
      .where({ company_id: companyId, driver_id: personId, status: 'ON_TRIP' })
      .whereNull('deleted_at')
      .count('id as count')
      .first(),
  ]);
  return { inside: Number(inside.count), onTrip: Number(onTrip.count) };
}

function updatePerson(trx, companyId, personId, data) {
  return trx('people').where({ id: personId, company_id: companyId }).update(data);
}

// Acessos em que a pessoa foi a visitante, com o tipo do veículo: placa de
// veículo de visitante identifica o dono (sai); veículo da frota é da
// empresa (fica).
function findAccessLogsAsVisitor(trx, companyId, personId) {
  return trx('access_logs')
    .leftJoin('vehicles', 'vehicles.id', 'access_logs.vehicle_id')
    .select(
      'access_logs.id',
      'access_logs.photo_url',
      'access_logs.signed_receipt_url',
      'access_logs.vehicle_id',
      'vehicles.vehicle_type'
    )
    .where({ 'access_logs.company_id': companyId, 'access_logs.person_id': personId });
}

function updateAccessLog(trx, id, data) {
  return trx('access_logs').where({ id }).update(data);
}

function findFleetLogIdsAsDriver(trx, companyId, personId) {
  return trx('fleet_logs').where({ company_id: companyId, driver_id: personId }).pluck('id');
}

function clearFleetLogObservations(trx, ids) {
  if (ids.length === 0) return 0;
  return trx('fleet_logs').whereIn('id', ids).update({ observation_encrypted: null });
}

function findAuditRows(trx, companyId, tableName, recordIds) {
  if (recordIds.length === 0) return [];
  return trx('audit_logs')
    .select('id', 'record_id', 'old_data', 'new_data')
    .where({ company_id: companyId, table_name: tableName })
    .whereIn('record_id', recordIds);
}

function updateAuditRow(trx, id, data) {
  return trx('audit_logs').where({ id }).update(data);
}

function insertAuditRecord(trx, { companyId, userId, personId }) {
  return trx('audit_logs').insert({
    company_id: companyId,
    user_id: userId,
    table_name: 'people',
    record_id: personId,
    action: 'ANONYMIZE',
  });
}

module.exports = {
  VEHICLE_TYPE_FLEET,
  findPerson,
  countOpenRecords,
  updatePerson,
  findAccessLogsAsVisitor,
  updateAccessLog,
  findFleetLogIdsAsDriver,
  clearFleetLogObservations,
  findAuditRows,
  updateAuditRow,
  insertAuditRecord,
};
