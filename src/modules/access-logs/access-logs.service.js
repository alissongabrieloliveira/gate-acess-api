const AppError = require('../../utils/AppError');
const assertBelongsToCompany = require('../../utils/assertBelongsToCompany');
const withAuthTransaction = require('../../utils/withAuthTransaction');
const { resolveKm } = require('../../utils/km');
const parseEditTimestamp = require('../../utils/parseEditTimestamp');
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
// people.person_type: 1=Visitante, 2=Prestador, 3=Funcionário.
const PERSON_TYPE_EMPLOYEE = 3;
// vehicles.vehicle_type: 2=Frota Própria.
const VEHICLE_TYPE_FLEET = 2;

/**
 * KM só é obrigatório quando há veículo E a pessoa é Funcionário. Visitante/
 * prestador com veículo de fora: opcional — o operador na fila da portaria não
 * precisa parar pra ler o painel de cada carro; e sem veículo não existe KM.
 * Veículo de Frota Própria não entra aqui: tem controle próprio (fleet-logs),
 * onde o KM é sempre obrigatório.
 */
function isKmRequired(person, vehicle) {
  return Boolean(vehicle) && person?.person_type === PERSON_TYPE_EMPLOYEE;
}

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

// id -> { id, name } de portões/setores (inclui soft-deletados, pro histórico).
async function namesByIds(repo, companyId, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const rows = await repo.findByIdsIncludingDeleted(unique, companyId);
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name }]));
}

/**
 * Anexa aos DTOs os dados de exibição dos registros relacionados (pessoa,
 * anfitrião, veículo, setor, portões), buscados em lote pelos ids da página.
 * Antes o frontend resolvia isso contra uma amostra de "até 100" cadastros e,
 * com mais cadastros, as linhas mostravam "Pessoa não encontrada".
 */
async function withRelated(companyId, dtos) {
  const [people, vehicles, sectors, gates] = await Promise.all([
    peopleService.summariesByIds(companyId, dtos.flatMap((d) => [d.personId, d.visitedPersonId])),
    vehiclesService.summariesByIds(companyId, dtos.map((d) => d.vehicleId)),
    namesByIds(sectorsRepository, companyId, dtos.map((d) => d.destinationSectorId)),
    namesByIds(gatesRepository, companyId, dtos.flatMap((d) => [d.entryGateId, d.exitGateId])),
  ]);
  return dtos.map((d) => ({
    ...d,
    person: people.get(d.personId) ?? null,
    visitedPerson: d.visitedPersonId ? (people.get(d.visitedPersonId) ?? null) : null,
    vehicle: d.vehicleId ? (vehicles.get(d.vehicleId) ?? null) : null,
    destinationSector: d.destinationSectorId ? (sectors.get(d.destinationSectorId) ?? null) : null,
    entryGate: gates.get(d.entryGateId) ?? null,
    exitGate: d.exitGateId ? (gates.get(d.exitGateId) ?? null) : null,
  }));
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
    data: await withRelated(companyId, await attachSignedPhotoUrls(rows.map(toDTO))),
    pagination: { page: safePage, limit: safeLimit, total: Number(totalRow.count) },
  };
}

async function listActive(companyId) {
  const rows = await repository.listActiveByCompany(companyId);
  return { data: await withRelated(companyId, await attachSignedPhotoUrls(rows.map(toDTO))) };
}

async function getById(companyId, id) {
  const log = await repository.findByIdAndCompany(id, companyId);
  if (!log) {
    throw new AppError('Registro de acesso não encontrado', 404);
  }
  const [dto] = await withRelated(companyId, [await singleDTO(log)]);
  return dto;
}

/**
 * Último KM conhecido do veículo neste controle (saída do último acesso, ou a
 * entrada se ele ainda está dentro / saiu sem KM) — usado pra pré-preencher e
 * conferir o KM de entrada do próximo acesso. `lastKm: null` = nunca houve KM.
 */
async function getLastKm(companyId, vehicleId) {
  await assertBelongsToCompany(
    vehiclesRepository,
    vehicleId,
    companyId,
    'vehicleId inválido: veículo não encontrado nesta empresa'
  );
  const row = await repository.findLastKnownKm(companyId, vehicleId);
  return { vehicleId, lastKm: row ? Number(row.km) : null };
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

  let vehicle = null;
  if (vehicleId !== undefined && vehicleId !== null) {
    vehicle = await assertBelongsToCompany(
      vehiclesRepository,
      Number(vehicleId),
      companyId,
      'vehicleId inválido: veículo não encontrado nesta empresa'
    );
    // Frota Própria tem controle exclusivo (fleet-logs): saída/retorno da
    // empresa, não acesso de fora pra dentro. Só vale na ENTRADA — acessos
    // antigos com esse tipo de veículo continuam podendo ser finalizados.
    if (vehicle.vehicle_type === VEHICLE_TYPE_FLEET) {
      throw new AppError(
        'Veículo da frota própria não passa pelo Controle de Acessos: registre a saída e o retorno pelo Controle de Frota',
        400
      );
    }
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

  const kmUnavailable = Boolean(isKmUnavailable);
  const kmEntryValue = resolveKm(kmEntry, {
    unavailable: kmUnavailable,
    required: isKmRequired(person, vehicle),
    label: 'KM de entrada',
  });

  try {
    const log = await withAuthTransaction(auth, (trx) =>
      repository.insert(
        {
          company_id: companyId,
          person_id: Number(personId),
          visited_person_id: visitedPersonId ? Number(visitedPersonId) : null,
          vehicle_id: vehicleId ? Number(vehicleId) : null,
          destination_sector_id: destinationSectorId ? Number(destinationSectorId) : null,
          is_km_unavailable: kmUnavailable,
          km_entry: kmEntryValue,
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

  // Pessoa/veículo do próprio log (já validados como da empresa na entrada);
  // só servem pra decidir se o KM de saída é obrigatório.
  const person = await peopleRepository.findByIdAndCompany(log.person_id, companyId);
  const vehicle = log.vehicle_id ? await vehiclesRepository.findByIdAndCompany(log.vehicle_id, companyId) : null;
  const kmUnavailable = Boolean(isKmUnavailable);
  const kmExitValue = resolveKm(kmExit, {
    unavailable: kmUnavailable,
    required: isKmRequired(person, vehicle),
    label: 'KM de saída',
  });
  // Saída IGUAL à entrada é o normal (o veículo só foi até o estacionamento);
  // só menor é impossível — o odômetro não volta.
  if (kmExitValue !== null && log.km_entry !== null && kmExitValue < log.km_entry) {
    throw new AppError(
      `KM de saída não pode ser menor que o KM de entrada (${log.km_entry}). ` +
        'Se o painel do veículo não está legível, marque "KM indisponível".',
      400
    );
  }

  const changes = {
    exit_time: new Date(),
    exit_gate_id: Number(exitGateId),
    exit_operator_id: auth.userId,
    status: STATUS.FINISHED,
  };
  if (kmExitValue !== null) changes.km_exit = kmExitValue;
  // Só liga o flag: se a entrada já foi marcada como indisponível, uma saída
  // com KM válido não pode desligar isso.
  if (kmUnavailable) changes.is_km_unavailable = true;
  if (observation !== undefined) changes.observation = observation;

  try {
    const updated = await withAuthTransaction(auth, (trx) => repository.update(id, companyId, changes, trx));
    return singleDTO(updated);
  } catch (err) {
    throw mapDbError(err);
  }
}

/**
 * Correção de um registro de acesso (só admin — ver routes): KM de entrada/
 * saída, flag "KM indisponível", setor de destino, anfitrião e datas de
 * entrada/saída. Atualização parcial: campo ausente (undefined) = mantém;
 * null = limpa (só setor e anfitrião aceitam). Aplica as MESMAS regras da
 * entrada/saída, pra edição não virar atalho que fura a validação. O
 * antes/depois fica na Auditoria (trigger de access_logs).
 */
async function updateLog(auth, id, payload) {
  const { companyId } = auth;
  const log = await repository.findByIdAndCompany(id, companyId);
  if (!log) {
    throw new AppError('Registro de acesso não encontrado', 404);
  }

  const has = (field) => payload[field] !== undefined;
  const isFinished = Boolean(log.exit_time);
  if (!isFinished && (has('kmExit') || has('exitTime'))) {
    throw new AppError(
      'Este acesso ainda não tem saída registrada: registre a saída pelo fluxo normal antes de editar KM ou data de saída',
      400
    );
  }

  const changes = {};

  if (has('destinationSectorId')) {
    if (payload.destinationSectorId === null) {
      changes.destination_sector_id = null;
    } else {
      await assertBelongsToCompany(
        sectorsRepository,
        Number(payload.destinationSectorId),
        companyId,
        'destinationSectorId inválido: setor não encontrado nesta empresa'
      );
      changes.destination_sector_id = Number(payload.destinationSectorId);
    }
  }

  if (has('visitedPersonId')) {
    if (payload.visitedPersonId === null) {
      changes.visited_person_id = null;
    } else {
      await assertBelongsToCompany(
        peopleRepository,
        Number(payload.visitedPersonId),
        companyId,
        'visitedPersonId inválido: pessoa não encontrada nesta empresa'
      );
      changes.visited_person_id = Number(payload.visitedPersonId);
    }
  }

  if (has('entryTime') || has('exitTime')) {
    const entryTime = has('entryTime') ? parseEditTimestamp(payload.entryTime, 'Data de entrada') : log.entry_time;
    const exitTime = has('exitTime') ? parseEditTimestamp(payload.exitTime, 'Data de saída') : log.exit_time;
    if (exitTime && new Date(exitTime) < new Date(entryTime)) {
      throw new AppError('Data de saída não pode ser anterior à data de entrada', 400);
    }
    if (has('entryTime')) changes.entry_time = entryTime;
    if (has('exitTime')) changes.exit_time = exitTime;
  }

  // KM só é revalidado quando a edição mexe em KM: registros antigos (de
  // antes da obrigatoriedade) podem ter o setor corrigido sem exigir KM.
  if (has('kmEntry') || has('kmExit') || has('isKmUnavailable')) {
    const unavailable = has('isKmUnavailable') ? Boolean(payload.isKmUnavailable) : Boolean(log.is_km_unavailable);
    const person = await peopleRepository.findByIdAndCompany(log.person_id, companyId);
    const vehicle = log.vehicle_id ? await vehiclesRepository.findByIdAndCompany(log.vehicle_id, companyId) : null;
    // Diferente da entrada/saída, aqui o flag NÃO apaga os números: ele é do
    // registro inteiro, e a entrada pode ter KM mesmo com a saída sem.
    const required = isKmRequired(person, vehicle) && !unavailable;

    const kmEntry = resolveKm(has('kmEntry') ? payload.kmEntry : log.km_entry, { required, label: 'KM de entrada' });
    const kmExit = isFinished
      ? resolveKm(has('kmExit') ? payload.kmExit : log.km_exit, { required, label: 'KM de saída' })
      : null;
    if (kmExit !== null && kmEntry !== null && kmExit < kmEntry) {
      throw new AppError(
        `KM de saída (${kmExit}) não pode ser menor que o KM de entrada (${kmEntry}). ` +
          'Se o painel do veículo não está legível, marque "KM indisponível".',
        400
      );
    }

    changes.km_entry = kmEntry;
    if (isFinished) changes.km_exit = kmExit;
    changes.is_km_unavailable = unavailable;
  }

  if (Object.keys(changes).length === 0) {
    return singleDTO(log);
  }

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

module.exports = { list, listActive, getById, getLastKm, registerEntry, registerExit, updateLog, setPhoto };
