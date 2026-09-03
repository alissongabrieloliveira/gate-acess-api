const AppError = require('../../utils/AppError');
const assertBelongsToCompany = require('../../utils/assertBelongsToCompany');
const repository = require('./access-logs.repository');
const peopleRepository = require('../people/people.repository');
const vehiclesRepository = require('../vehicles/vehicles.repository');
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
    status: log.status,
    observation: log.observation,
    createdAt: log.created_at,
    updatedAt: log.updated_at,
  };
}

async function list(companyId, { page, limit, status, personId, from, to } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const filters = {
    status: status || undefined,
    personId: personId !== undefined ? Number(personId) : undefined,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  };

  const [rows, totalRow] = await Promise.all([
    repository.listByCompany(companyId, { limit: safeLimit, offset, ...filters }),
    repository.countByCompany(companyId, filters),
  ]);

  return {
    data: rows.map(toDTO),
    pagination: { page: safePage, limit: safeLimit, total: Number(totalRow.count) },
  };
}

async function listActive(companyId) {
  const rows = await repository.listActiveByCompany(companyId);
  return { data: rows.map(toDTO) };
}

async function getById(companyId, id) {
  const log = await repository.findByIdAndCompany(id, companyId);
  if (!log) {
    throw new AppError('Registro de acesso não encontrado', 404);
  }
  return toDTO(log);
}

async function registerEntry(companyId, operatorId, payload) {
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
    const log = await repository.insert({
      company_id: companyId,
      person_id: Number(personId),
      visited_person_id: visitedPersonId ? Number(visitedPersonId) : null,
      vehicle_id: vehicleId ? Number(vehicleId) : null,
      destination_sector_id: destinationSectorId ? Number(destinationSectorId) : null,
      is_km_unavailable: Boolean(isKmUnavailable),
      km_entry: kmEntry !== undefined ? Number(kmEntry) : null,
      visit_reason: visitReason || null,
      entry_gate_id: Number(entryGateId),
      entry_operator_id: operatorId,
      receipt_code: receiptCode || null,
      signed_receipt_url: signedReceiptUrl || null,
      observation: observation || null,
    });
    return toDTO(log);
  } catch (err) {
    throw mapDbError(err);
  }
}

async function registerExit(companyId, operatorId, id, payload) {
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
    exit_operator_id: operatorId,
    status: STATUS.FINISHED,
  };
  if (kmExit !== undefined) changes.km_exit = Number(kmExit);
  if (isKmUnavailable !== undefined) changes.is_km_unavailable = Boolean(isKmUnavailable);
  if (observation !== undefined) changes.observation = observation;

  try {
    const updated = await repository.update(id, companyId, changes);
    return toDTO(updated);
  } catch (err) {
    throw mapDbError(err);
  }
}

module.exports = { list, listActive, getById, registerEntry, registerExit };
