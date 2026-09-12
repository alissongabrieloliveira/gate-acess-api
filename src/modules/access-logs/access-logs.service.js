const AppError = require('../../utils/AppError');
const assertBelongsToCompany = require('../../utils/assertBelongsToCompany');
const withAuthTransaction = require('../../utils/withAuthTransaction');
const { attachSignedPhotoUrls, deletePhoto: deleteStoragePhoto } = require('../../utils/supabaseStorage');
const repository = require('./access-logs.repository');
const peopleRepository = require('../people/people.repository');
const peopleService = require('../people/people.service');
const vehiclesRepository = require('../vehicles/vehicles.repository');
const vehiclesService = require('../vehicles/vehicles.service');
const gatesRepository = require('../gates/gates.repository');
const sectorsRepository = require('../sectors/sectors.repository');

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const STATUS = { ACTIVE: 'ACTIVE', FINISHED: 'FINISHED' };

function mapDbError(err) {
  if (err.code === UNIQUE_VIOLATION) {
    return new AppError('Já existe um registro com esse código de recibo nesta empresa', 409);
  }
  if (err.code === CHECK_VIOLATION) {
    return new AppError('Dados inconsistentes (verifique KM ou datas informadas)', 400);
  }
  return err;
}

function toDTO(log) {
  if (!log) return null;
  return {
    id: log.id,
    personId: log.person_id,
    visitedPersonId: log.visited_person_id,
    vehicleId: log.vehicle_id,
    destinationSectorId: log.destination_sector_id,
    isKmUnavailable: log.is_km_unavailable,
    kmEntry: log.km_entry,
    kmExit: log.km_exit,
    visitReason: log.visit_reason,
    entryTime: log.entry_time,
    entryGateId: log.entry_gate_id,
    entryOperatorId: log.entry_operator_id,
    exitTime: log.exit_time,
    exitGateId: log.exit_gate_id,
    exitOperatorId: log.exit_operator_id,
    receiptCode: log.receipt_code,
    signedReceiptUrl: log.signed_receipt_url,
    // Ainda é o CAMINHO cru no bucket aqui, não uma URL de verdade — só vira
    // URL assinada em singleDTO()/attachSignedPhotoUrls() (mesmo padrão de
    // people.service.js/vehicles.service.js).
    photoUrl: log.photo_url,
    status: log.status,
    observation: log.observation,
    createdAt: log.created_at,
    updatedAt: log.updated_at,
  };
}

async function singleDTO(log) {
  const [dto] = await attachSignedPhotoUrls([toDTO(log)]);
  return dto;
}

/**
 * `search` (?search=, "CPF, Nome ou Placa") não existe como coluna em
 * access_logs — só person_id/vehicle_id. Resolve primeiro quais pessoas e
 * veículos batem com o termo (peopleService/vehiclesService.searchIds, que
 * já sabem decriptar/comparar cada um do jeito certo), depois filtra
 * access_logs por WHERE person_id IN (...) OR vehicle_id IN (...) — a
 * paginação em si continua via SQL LIMIT/OFFSET, só o "quem bate" precisa
 * de um passo a mais. Se a busca não encontrar nenhuma pessoa nem veículo,
 * retorna vazio sem nem consultar access_logs.
 */
async function list(companyId, { page, limit, status, personId, from, to, search } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const filters = {
    status: status || undefined,
    personId: personId !== undefined ? Number(personId) : undefined,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  };

  if (search && search.trim()) {
    const [personIds, vehicleIds] = await Promise.all([
      peopleService.searchIds(companyId, search),
      vehiclesService.searchIds(companyId, search),
    ]);
    if (!personIds.length && !vehicleIds.length) {
      return { data: [], pagination: { page: safePage, limit: safeLimit, total: 0 } };
    }
    filters.personIds = personIds;
    filters.vehicleIds = vehicleIds;
  }

  const [rows, totalRow] = await Promise.all([
    repository.listByCompany(companyId, { limit: safeLimit, offset, ...filters }),
    repository.countByCompany(companyId, filters),
  ]);

  return {
    data: await attachSignedPhotoUrls(rows.map(toDTO)),
    pagination: { page: safePage, limit: safeLimit, total: Number(totalRow.count) },
  };
}

async function listActive(companyId) {
  const rows = await repository.listActiveByCompany(companyId);
  return { data: await attachSignedPhotoUrls(rows.map(toDTO)) };
}

async function getById(companyId, id) {
  const log = await repository.findByIdAndCompany(id, companyId);
  if (!log) {
    throw new AppError('Registro de acesso não encontrado', 404);
  }
  return singleDTO(log);
}

async function registerEntry(auth, payload) {
  const { companyId } = auth;
  const {
    personId,
    visitedPersonId,
    vehicleId,
    destinationSectorId,
    entryGateId,
    visitReason,
    kmEntry,
    isKmUnavailable,
    receiptCode,
    signedReceiptUrl,
    observation,
  } = payload;

  if (!personId || !entryGateId) {
    throw new AppError('personId e entryGateId são obrigatórios', 400);
  }

  const person = await assertBelongsToCompany(
    peopleRepository,
    Number(personId),
    companyId,
    'personId inválido: pessoa não encontrada nesta empresa'
  );
  if (person.is_blocked) {
    throw new AppError(`Pessoa bloqueada: ${person.block_reason || 'sem motivo informado'}`, 403);
  }

  if (visitedPersonId !== undefined && visitedPersonId !== null) {
    await assertBelongsToCompany(
      peopleRepository,
      Number(visitedPersonId),
      companyId,
      'visitedPersonId inválido: pessoa não encontrada nesta empresa'
    );
  }

  if (vehicleId !== undefined && vehicleId !== null) {
    const vehicle = await assertBelongsToCompany(
      vehiclesRepository,
      Number(vehicleId),
      companyId,
      'vehicleId inválido: veículo não encontrado nesta empresa'
    );
    if (vehicle.is_blocked) {
      throw new AppError(`Veículo bloqueado: ${vehicle.block_reason || 'sem motivo informado'}`, 403);
    }
  }

  if (destinationSectorId !== undefined && destinationSectorId !== null) {
    await assertBelongsToCompany(
      sectorsRepository,
      Number(destinationSectorId),
      companyId,
      'destinationSectorId inválido: setor não encontrado nesta empresa'
    );
  }

  await assertBelongsToCompany(
    gatesRepository,
    Number(entryGateId),
    companyId,
    'entryGateId inválido: portão não encontrado nesta empresa'
  );

  try {
    const log = await withAuthTransaction(auth, (trx) =>
      repository.insert(
        {
          company_id: companyId,
          person_id: Number(personId),
          visited_person_id: visitedPersonId ? Number(visitedPersonId) : null,
          vehicle_id: vehicleId ? Number(vehicleId) : null,
          destination_sector_id: destinationSectorId ? Number(destinationSectorId) : null,
          is_km_unavailable: Boolean(isKmUnavailable),
          km_entry: kmEntry !== undefined ? Number(kmEntry) : null,
          visit_reason: visitReason || null,
          entry_gate_id: Number(entryGateId),
          entry_operator_id: auth.userId,
          receipt_code: receiptCode || null,
          signed_receipt_url: signedReceiptUrl || null,
          observation: observation || null,
        },
        trx
      )
    );
    return singleDTO(log);
  } catch (err) {
    throw mapDbError(err);
  }
}

async function registerExit(auth, id, payload) {
  const { companyId } = auth;
  const log = await repository.findByIdAndCompany(id, companyId);
  if (!log) {
    throw new AppError('Registro de acesso não encontrado', 404);
  }
  if (log.status !== STATUS.ACTIVE || log.exit_time) {
    throw new AppError('Este acesso já foi finalizado', 409);
  }

  const { exitGateId, kmExit, isKmUnavailable, observation } = payload;
  if (!exitGateId) {
    throw new AppError('exitGateId é obrigatório', 400);
  }

  await assertBelongsToCompany(
    gatesRepository,
    Number(exitGateId),
    companyId,
    'exitGateId inválido: portão não encontrado nesta empresa'
  );

  const changes = {
    exit_time: new Date(),
    exit_gate_id: Number(exitGateId),
    exit_operator_id: auth.userId,
    status: STATUS.FINISHED,
  };
  if (kmExit !== undefined) changes.km_exit = Number(kmExit);
  if (isKmUnavailable !== undefined) changes.is_km_unavailable = Boolean(isKmUnavailable);
  if (observation !== undefined) changes.observation = observation;

  try {
    const updated = await withAuthTransaction(auth, (trx) => repository.update(id, companyId, changes, trx));
    return singleDTO(updated);
  } catch (err) {
    throw mapDbError(err);
  }
}

// Foto tirada no momento da entrada (tipicamente do veículo) — escopada ao
// access_log em si, não a people/vehicles (ver migration
// 20260912110000_add_photo_url_to_access_logs.js). Busca a linha crua
// primeiro (não o DTO) pra achar o caminho antigo no bucket sem vazar esse
// caminho interno pra fora da API, mesmo padrão de people.service.js#setPhoto.
async function setPhoto(auth, id, photoPath) {
  const existing = await repository.findByIdAndCompany(id, auth.companyId);
  if (!existing) {
    throw new AppError('Registro de acesso não encontrado', 404);
  }
  if (existing.photo_url) {
    await deleteStoragePhoto(existing.photo_url);
  }

  const log = await withAuthTransaction(auth, (trx) =>
    repository.update(id, auth.companyId, { photo_url: photoPath }, trx)
  );
  return singleDTO(log);
}

module.exports = { list, listActive, getById, registerEntry, registerExit, setPhoto };
