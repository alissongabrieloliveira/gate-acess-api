const repository = require('./anonymization.repository');
const AppError = require('../../utils/AppError');
const withAuthTransaction = require('../../utils/withAuthTransaction');
const { encryptField } = require('../../utils/crypto');
const { deletePhoto } = require('../../utils/supabaseStorage');
const logger = require('../../utils/logger');

// Campos que identificam a pessoa — zerados no cadastro e nas cópias da
// trilha de auditoria. (name_encrypted é NOT NULL: vira o texto genérico.)
const PERSON_KEYS = ['cpf_encrypted', 'cpf_bindex', 'rg_encrypted', 'phone_encrypted', 'photo_url', 'block_reason_encrypted'];
// Nos acessos em que ela foi a visitante: texto livre, foto e recibo.
const ACCESS_KEYS = ['visit_reason_encrypted', 'observation_encrypted', 'photo_url', 'signed_receipt_url'];
const FLEET_KEYS = ['observation_encrypted'];

function anonymousName(personId) {
  return `Titular anonimizado #${personId}`;
}

function scrubSnapshot(data, overrides) {
  if (!data) return data;
  const result = { ...data };
  for (const [key, value] of Object.entries(overrides)) {
    if (key in result) result[key] = value;
  }
  return result;
}

// Reescreve as cópias antigas (old_data/new_data) da trilha — inclusive as
// que os próprios UPDATEs desta anonimização acabaram de gerar, que trazem
// em old_data os dados sendo removidos. Por isso roda por último.
// `overridesFor(recordId)`: campos a zerar nas cópias daquele registro.
async function scrubAuditTrail(trx, companyId, tableName, recordIds, overridesFor) {
  const rows = await repository.findAuditRows(trx, companyId, tableName, recordIds);
  for (const row of rows) {
    const overrides = overridesFor(row.record_id);
    await repository.updateAuditRow(trx, row.id, {
      old_data: scrubSnapshot(row.old_data, overrides),
      new_data: scrubSnapshot(row.new_data, overrides),
    });
  }
}

/**
 * LGPD art. 18 (anonimização a pedido do titular). Mantém todos os
 * registros de acesso e frota — datas, postos, setores, KM, veículo da
 * frota — e remove só o que identifica a pessoa: dados do cadastro, foto,
 * textos livres, foto/recibo das visitas e a placa de veículo de visitante
 * (a de veículo da frota é da empresa e fica). Irreversível.
 *
 * Recusa pessoa bloqueada (o bloqueio é justamente motivo de segurança pra
 * guardar — desbloquear primeiro, se for o caso) e pessoa com registro em
 * aberto (dentro da empresa ou em viagem).
 */
async function anonymizePerson(auth, personId) {
  const { companyId, userId } = auth;
  const filesToDelete = [];

  const result = await withAuthTransaction(auth, async (trx) => {
    const person = await repository.findPerson(trx, companyId, personId);
    if (!person) throw new AppError('Pessoa não encontrada', 404);
    if (person.anonymized_at) throw new AppError('Esta pessoa já foi anonimizada', 409);
    if (person.is_blocked) {
      throw new AppError(
        'Pessoa bloqueada não pode ser anonimizada: o bloqueio é um motivo de segurança para manter os dados. Desbloqueie antes, se for o caso.',
        409
      );
    }
    const open = await repository.countOpenRecords(trx, companyId, personId);
    if (open.inside > 0) throw new AppError('A pessoa está dentro da empresa: registre a saída antes de anonimizar', 409);
    if (open.onTrip > 0) throw new AppError('A pessoa está em viagem com um veículo da frota: registre o retorno antes', 409);

    const anonymizedAt = new Date();
    if (person.photo_url) filesToDelete.push(person.photo_url);
    await repository.updatePerson(trx, companyId, personId, {
      name_encrypted: encryptField(anonymousName(personId)),
      ...Object.fromEntries(PERSON_KEYS.map((key) => [key, null])),
      anonymized_at: anonymizedAt,
    });

    const accessLogs = await repository.findAccessLogsAsVisitor(trx, companyId, personId);
    const unlinkedVehicle = new Set();
    for (const log of accessLogs) {
      filesToDelete.push(log.photo_url, log.signed_receipt_url);
      const changes = Object.fromEntries(ACCESS_KEYS.map((key) => [key, null]));
      if (log.vehicle_id && log.vehicle_type !== repository.VEHICLE_TYPE_FLEET) {
        changes.vehicle_id = null;
        unlinkedVehicle.add(log.id);
      }
      await repository.updateAccessLog(trx, log.id, changes);
    }

    const fleetLogIds = await repository.findFleetLogIdsAsDriver(trx, companyId, personId);
    await repository.clearFleetLogObservations(trx, fleetLogIds);

    await scrubAuditTrail(trx, companyId, 'people', [personId], () => ({
      name_encrypted: null,
      ...Object.fromEntries(PERSON_KEYS.map((key) => [key, null])),
    }));
    // vehicle_id só é zerado nas cópias dos acessos em que o veículo era de
    // visitante (mesma regra do registro em si).
    const accessOverrides = Object.fromEntries(ACCESS_KEYS.map((key) => [key, null]));
    await scrubAuditTrail(
      trx,
      companyId,
      'access_logs',
      accessLogs.map((log) => log.id),
      (recordId) => (unlinkedVehicle.has(recordId) ? { ...accessOverrides, vehicle_id: null } : accessOverrides)
    );
    await scrubAuditTrail(trx, companyId, 'fleet_logs', fleetLogIds, () =>
      Object.fromEntries(FLEET_KEYS.map((key) => [key, null]))
    );

    await repository.insertAuditRecord(trx, { companyId, userId, personId });

    return {
      id: personId,
      anonymizedAt,
      accessLogsUpdated: accessLogs.length,
      fleetLogsUpdated: fleetLogIds.length,
    };
  });

  // Arquivos só são apagados depois do commit (se a transação falhasse, o
  // cadastro continuaria apontando pra fotos que não existem mais).
  const paths = filesToDelete.filter(Boolean);
  await Promise.all(paths.map((path) => deletePhoto(path)));
  logger.info({ personId, companyId, files: paths.length }, 'Pessoa anonimizada (LGPD)');

  return { ...result, filesDeleted: paths.length };
}

module.exports = { anonymizePerson, anonymousName };
