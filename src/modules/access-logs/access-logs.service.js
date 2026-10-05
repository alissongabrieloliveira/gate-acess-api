const AppError = require('../../utils/AppError');
const { encryptField, decryptField } = require('../../utils/crypto');
const assertBelongsToCompany = require('../../utils/assertBelongsToCompany');
const withAuthTransaction = require('../../utils/withAuthTransaction');
const { resolveKm } = require('../../utils/km');
const parseEditTimestamp = require('../../utils/parseEditTimestamp');
const { parseRetroactiveTime, parseRetroactiveReason, formatDateTime } = require('../../utils/retroactive');
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
  // Corrida entre dois cadastros simultâneos que passaram pela checagem do
  // service (assertNoOverlap) ao mesmo tempo.
  if (err.code === UNIQUE_VIOLATION && err.constraint === 'idx_access_logs_person_active') {
    return new AppError('Esta pessoa já tem uma entrada em aberto: registre a saída antes de uma nova entrada', 409);
  }
  if (err.code === UNIQUE_VIOLATION && err.constraint === 'idx_access_logs_vehicle_active') {
    return new AppError('Este veículo já tem uma entrada em aberto: registre a saída antes de uma nova entrada', 409);
  }
  if (err.code === UNIQUE_VIOLATION) {
    return new AppError('Já existe um registro com esse código de recibo nesta empresa', 409);
  }
  if (err.code === CHECK_VIOLATION) {
    return new AppError('Dados inconsistentes (verifique KM ou datas informadas)', 400);
  }
  return err;
}

function describePeriod(log) {
  const entry = `entrada em ${formatDateTime(log.entry_time)}`;
  return log.exit_time ? `${entry}, saída em ${formatDateTime(log.exit_time)}` : `${entry}, ainda dentro`;
}

/**
 * A mesma pessoa/veículo não pode ter dois registros cujo período se cruza —
 * em particular, no máximo UMA entrada em aberto (mesma regra dos índices
 * idx_access_logs_person_active / idx_access_logs_vehicle_active, que aqui
 * ganha uma mensagem dizendo onde está o registro que conflita). Vale para
 * lançamento normal, retroativo (`to` = saída informada junto, ou null =
 * ainda dentro) e para a edição (`excludeId` = o próprio registro).
 * Só olha access_logs: o funcionário que entrou com o carro próprio pode sair
 * num veículo da frota (fleet-logs) com o acesso ainda em aberto.
 */
async function assertNoOverlap(companyId, { person, vehicle }, { from, to = null, excludeId }) {
  const period = { from, to, excludeId };
  // "Já está dentro" é o caso do dia a dia (entrada nova com a anterior em
  // aberto); o resto é sobreposição de lançamento retroativo/edição.
  const message = (subject, conflict, extra = '') => {
    if (!conflict.exit_time && new Date(conflict.entry_time) <= from) {
      return (
        `${subject} já está dentro (entrada em ${formatDateTime(conflict.entry_time)}${extra}). ` +
        'Registre a saída antes de uma nova entrada.'
      );
    }
    return (
      `${subject} já tem registro nesse período (${describePeriod(conflict)}${extra}).` +
      (to || excludeId !== undefined ? '' : ' Se já saiu, informe também a saída.')
    );
  };

  if (person) {
    const conflict = await repository.findOverlapping(companyId, 'person_id', person.id, period);
    if (conflict) {
      throw new AppError(message(decryptField(person.name_encrypted) || 'Esta pessoa', conflict), 409);
    }
  }
  if (vehicle) {
    const conflict = await repository.findOverlapping(companyId, 'vehicle_id', vehicle.id, period);
    if (conflict) {
      const driver = await peopleRepository.findByIdAndCompany(conflict.person_id, companyId);
      const driverName = driver ? decryptField(driver.name_encrypted) : null;
      throw new AppError(
        message(`Veículo ${vehicle.license_plate}`, conflict, driverName ? `, com ${driverName}` : ''),
        409
      );
    }
  }
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
    visitReason: decryptField(log.visit_reason_encrypted),
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
    observation: decryptField(log.observation_encrypted),
    // Lançamento retroativo: justificativa preenchida = passagem lançada
    // depois (selo nas telas). A entrada foi lançada de fato em createdAt.
    entryRetroactiveReason: decryptField(log.entry_retroactive_reason_encrypted),
    exitRetroactiveReason: decryptField(log.exit_retroactive_reason_encrypted),
    exitRecordedAt: log.exit_recorded_at,
    isRetroactive: Boolean(log.entry_retroactive_reason_encrypted || log.exit_retroactive_reason_encrypted),
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
// visit_reason tem até 255 caracteres: validado aqui, no texto em claro (a
// coluna cifrada é TEXT). Texto vazio vira null.
function parseLimitedText(value, label) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (text.length > 255) {
    throw new AppError(`${label} pode ter no máximo 255 caracteres`, 400);
  }
  return text || null;
}

async function list(companyId, { page, limit, status, personId, entryGateId, from, to, search } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  if (entryGateId !== undefined && !Number.isInteger(Number(entryGateId))) {
    throw new AppError('entryGateId inválido', 400);
  }
  const filters = {
    status: status || undefined,
    personId: personId !== undefined ? Number(personId) : undefined,
    entryGateId: entryGateId !== undefined ? Number(entryGateId) : undefined,
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
    exitGateId,
    kmExit,
  } = payload;

  if (!personId || !entryGateId) {
    throw new AppError('personId e entryGateId são obrigatórios', 400);
  }

  // Lançamento retroativo (esqueceu de registrar na hora): entrada no passado
  // e, se a pessoa já saiu, a saída junto — senão fica dentro e sai pelo
  // fluxo normal. Sem entryTime é a entrada de agora, como sempre.
  const entryTime = parseRetroactiveTime(auth, payload.entryTime, 'Data de entrada');
  const exitTime = parseRetroactiveTime(auth, payload.exitTime, 'Data de saída');
  if (exitTime && !entryTime) {
    throw new AppError('Saída junto com a entrada só vale para lançamento retroativo (informe a data de entrada)', 400);
  }
  if (exitTime && exitTime < entryTime) {
    throw new AppError('Data de saída não pode ser anterior à data de entrada', 400);
  }
  const retroactiveReason = entryTime ? parseRetroactiveReason(payload.retroactiveReason) : null;
  if (exitTime && !exitGateId) {
    throw new AppError('Informe o posto de saída', 400);
  }

  const person = await assertBelongsToCompany(
    peopleRepository,
    Number(personId),
    companyId,
    'personId inválido: pessoa não encontrada nesta empresa'
  );
  if (person.is_blocked) {
    throw new AppError(`Pessoa bloqueada: ${decryptField(person.block_reason_encrypted) || 'sem motivo informado'}`, 403);
  }
  if (person.anonymized_at) {
    throw new AppError('Pessoa anonimizada (LGPD) não pode ser usada em um registro novo', 400);
  }

  if (visitedPersonId !== undefined && visitedPersonId !== null) {
    const host = await assertBelongsToCompany(
      peopleRepository,
      Number(visitedPersonId),
      companyId,
      'visitedPersonId inválido: pessoa não encontrada nesta empresa'
    );
    if (host.anonymized_at) {
      throw new AppError('Anfitrião anonimizado (LGPD) não pode ser usado em um registro novo', 400);
    }
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
      throw new AppError(`Veículo bloqueado: ${decryptField(vehicle.block_reason_encrypted) || 'sem motivo informado'}`, 403);
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

  if (exitTime) {
    await assertBelongsToCompany(
      gatesRepository,
      Number(exitGateId),
      companyId,
      'exitGateId inválido: portão não encontrado nesta empresa'
    );
  }

  const now = new Date();
  await assertNoOverlap(companyId, { person, vehicle }, { from: entryTime ?? now, to: exitTime });

  const kmUnavailable = Boolean(isKmUnavailable);
  const kmEntryValue = resolveKm(kmEntry, {
    unavailable: kmUnavailable,
    required: isKmRequired(person, vehicle),
    label: 'KM de entrada',
  });
  const kmExitValue = exitTime
    ? resolveKm(kmExit, { unavailable: kmUnavailable, required: isKmRequired(person, vehicle), label: 'KM de saída' })
    : null;
  if (kmExitValue !== null && kmEntryValue !== null && kmExitValue < kmEntryValue) {
    throw new AppError(
      `KM de saída não pode ser menor que o KM de entrada (${kmEntryValue}). ` +
        'Se o painel do veículo não está legível, marque "KM indisponível".',
      400
    );
  }
  const retroactiveReasonEncrypted = encryptField(retroactiveReason);

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
          visit_reason_encrypted: encryptField(parseLimitedText(visitReason, 'Motivo da visita')),
          entry_gate_id: Number(entryGateId),
          entry_operator_id: auth.userId,
          receipt_code: receiptCode || null,
          signed_receipt_url: signedReceiptUrl || null,
          observation_encrypted: encryptField(observation || null),
          // Sem entryTime, entry_time fica com o DEFAULT do banco (agora).
          ...(entryTime && { entry_time: entryTime, entry_retroactive_reason_encrypted: retroactiveReasonEncrypted }),
          ...(exitTime && {
            exit_time: exitTime,
            exit_gate_id: Number(exitGateId),
            exit_operator_id: auth.userId,
            km_exit: kmExitValue,
            status: STATUS.FINISHED,
            exit_retroactive_reason_encrypted: retroactiveReasonEncrypted,
            exit_recorded_at: now,
          }),
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
  // Saída retroativa: a pessoa saiu antes e o operador esqueceu de registrar.
  const exitTime = parseRetroactiveTime(auth, payload.exitTime, 'Data de saída');
  const retroactiveReason = exitTime ? parseRetroactiveReason(payload.retroactiveReason) : null;
  if (exitTime && exitTime < new Date(log.entry_time)) {
    throw new AppError(
      `Data de saída não pode ser anterior à data de entrada (${formatDateTime(log.entry_time)})`,
      400
    );
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
    exit_time: exitTime ?? new Date(),
    exit_gate_id: Number(exitGateId),
    exit_operator_id: auth.userId,
    status: STATUS.FINISHED,
  };
  if (exitTime) {
    changes.exit_retroactive_reason_encrypted = encryptField(retroactiveReason);
    changes.exit_recorded_at = new Date();
  }
  if (kmExitValue !== null) changes.km_exit = kmExitValue;
  // Só liga o flag: se a entrada já foi marcada como indisponível, uma saída
  // com KM válido não pode desligar isso.
  if (kmUnavailable) changes.is_km_unavailable = true;
  if (observation !== undefined) changes.observation_encrypted = encryptField(observation || null);

  try {
    const updated = await withAuthTransaction(auth, (trx) => repository.update(id, companyId, changes, trx));
    return singleDTO(updated);
  } catch (err) {
    throw mapDbError(err);
  }
}

/**
 * Correção de um registro de acesso (só admin — ver routes): pessoa e
 * veículo (troca por outro cadastro), KM de entrada/saída, flag "KM
 * indisponível", setor de destino, anfitrião e datas de entrada/saída.
 * Atualização parcial: campo ausente (undefined) = mantém; null = limpa (só
 * veículo, setor e anfitrião aceitam). Aplica as MESMAS regras da
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

  // Troca da pessoa/veículo (indicados errado na entrada) por outro cadastro
  // — corrigir nome/CPF/placa do cadastro em si é em Cadastros.
  let person = null;
  if (has('personId')) {
    if (!payload.personId) {
      throw new AppError('Informe a pessoa do registro', 400);
    }
    person = await assertBelongsToCompany(
      peopleRepository,
      Number(payload.personId),
      companyId,
      'personId inválido: pessoa não encontrada nesta empresa'
    );
    if (person.anonymized_at) {
      throw new AppError('Pessoa anonimizada (LGPD) não pode ser usada', 400);
    }
    changes.person_id = person.id;
  }

  let vehicle;
  if (has('vehicleId')) {
    if (payload.vehicleId === null) {
      vehicle = null;
      changes.vehicle_id = null;
    } else {
      vehicle = await assertBelongsToCompany(
        vehiclesRepository,
        Number(payload.vehicleId),
        companyId,
        'vehicleId inválido: veículo não encontrado nesta empresa'
      );
      if (vehicle.vehicle_type === VEHICLE_TYPE_FLEET && vehicle.id !== log.vehicle_id) {
        throw new AppError(
          'Veículo da frota própria não passa pelo Controle de Acessos: registre pelo Controle de Frota',
          400
        );
      }
      changes.vehicle_id = vehicle.id;
    }
  }

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

  // Pessoa, veículo ou datas mudaram: o período final não pode cruzar outro
  // registro da mesma pessoa/veículo (registro em aberto vai até agora em diante).
  const personChanged = changes.person_id !== undefined && changes.person_id !== log.person_id;
  const vehicleChanged = changes.vehicle_id !== undefined && changes.vehicle_id !== log.vehicle_id;
  const timesChanged = changes.entry_time !== undefined || changes.exit_time !== undefined;
  if (personChanged || vehicleChanged || timesChanged) {
    const checkPerson = personChanged || timesChanged;
    const checkVehicle = (vehicleChanged || timesChanged) && changes.vehicle_id !== null;
    const finalVehicleId = changes.vehicle_id !== undefined ? changes.vehicle_id : log.vehicle_id;
    await assertNoOverlap(
      companyId,
      {
        person: checkPerson
          ? (person ?? (await peopleRepository.findByIdAndCompany(log.person_id, companyId)))
          : null,
        vehicle:
          checkVehicle && finalVehicleId
            ? (vehicle ?? (await vehiclesRepository.findByIdAndCompany(finalVehicleId, companyId)))
            : null,
      },
      {
        from: new Date(changes.entry_time ?? log.entry_time),
        to: (changes.exit_time ?? log.exit_time) ? new Date(changes.exit_time ?? log.exit_time) : null,
        excludeId: log.id,
      }
    );
  }

  // KM só é revalidado quando a edição mexe em KM: registros antigos (de
  // antes da obrigatoriedade) podem ter o setor corrigido sem exigir KM.
  // Sem veículo não há KM: tirar o veículo do registro limpa o KM junto.
  if (has('vehicleId') && payload.vehicleId === null) {
    changes.km_entry = null;
    changes.km_exit = null;
    changes.is_km_unavailable = false;
  } else if (has('kmEntry') || has('kmExit') || has('isKmUnavailable')) {
    const unavailable = has('isKmUnavailable') ? Boolean(payload.isKmUnavailable) : Boolean(log.is_km_unavailable);
    // Obrigatoriedade pela pessoa/veículo que ficam no registro (os novos,
    // se a mesma edição trocou).
    if (!person) person = await peopleRepository.findByIdAndCompany(log.person_id, companyId);
    if (vehicle === undefined) {
      vehicle = log.vehicle_id ? await vehiclesRepository.findByIdAndCompany(log.vehicle_id, companyId) : null;
    }
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

// Exportação de dados do titular (LGPD): acessos em que a pessoa foi
// visitante e em que foi anfitriã, sem paginação e sem URL de foto (o
// documento exportado não depende de link temporário).
async function listAllForPerson(companyId, personId) {
  const [asVisitor, asHost] = await Promise.all([
    repository.listAllByPersonColumn(companyId, 'person_id', personId),
    repository.listAllByPersonColumn(companyId, 'visited_person_id', personId),
  ]);
  const [visitor, host] = await Promise.all([
    withRelated(companyId, asVisitor.map(toDTO)),
    withRelated(companyId, asHost.map(toDTO)),
  ]);
  return { asVisitor: visitor, asHost: host };
}

module.exports = {
  list,
  listActive,
  getById,
  getLastKm,
  registerEntry,
  registerExit,
  updateLog,
  setPhoto,
  listAllForPerson,
};
