const AppError = require('../../utils/AppError');
const { encryptField, decryptField } = require('../../utils/crypto');
const assertBelongsToCompany = require('../../utils/assertBelongsToCompany');
const withAuthTransaction = require('../../utils/withAuthTransaction');
const { resolveKm } = require('../../utils/km');
const parseEditTimestamp = require('../../utils/parseEditTimestamp');
const repository = require('./fleet-logs.repository');
const peopleRepository = require('../people/people.repository');
const peopleService = require('../people/people.service');
const vehiclesRepository = require('../vehicles/vehicles.repository');
const vehiclesService = require('../vehicles/vehicles.service');
const gatesRepository = require('../gates/gates.repository');
const { normalizePlate } = vehiclesService;

// id -> { id, name } de portões/setores (inclui soft-deletados, pro histórico).
async function namesByIds(repo, companyId, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const rows = await repo.findByIdsIncludingDeleted(unique, companyId);
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name }]));
}

/**
 * Anexa aos DTOs os dados de exibição do veículo, motorista, guincho
 * (`transportingVehicle`, no registro do veículo levado em cima), veículos da
 * frota levados em cima (`carriedLogs`, no registro do guincho) e portões,
 * buscados em lote — ver access-logs.service#withRelated.
 */
async function withRelated(companyId, dtos) {
  const carriedRows = await repository.listCarriedByTransportLogIds(
    companyId,
    dtos.map((d) => d.id)
  );
  const carried = carriedRows.map(toDTO);
  const [vehicles, people, gates] = await Promise.all([
    vehiclesService.summariesByIds(
      companyId,
      [...dtos, ...carried].flatMap((d) => [d.vehicleId, d.transportingVehicleId])
    ),
    peopleService.summariesByIds(companyId, dtos.map((d) => d.driverId)),
    namesByIds(gatesRepository, companyId, dtos.flatMap((d) => [d.departureGateId, d.returnGateId])),
  ]);
  return dtos.map((d) => ({
    ...d,
    vehicle: vehicles.get(d.vehicleId) ?? null,
    driver: d.driverId ? (people.get(d.driverId) ?? null) : null,
    transportingVehicle: d.transportingVehicleId ? (vehicles.get(d.transportingVehicleId) ?? null) : null,
    carriedLogs: carried
      .filter((c) => c.transportLogId === d.id)
      .map((c) => ({
        id: c.id,
        status: c.status,
        noReturnReason: c.noReturnReason,
        vehicle: vehicles.get(c.vehicleId) ?? null,
      })),
    departureGate: gates.get(d.departureGateId) ?? null,
    returnGate: d.returnGateId ? (gates.get(d.returnGateId) ?? null) : null,
  }));
}

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const STATUS = { ON_TRIP: 'ON_TRIP', RETURNED: 'RETURNED', NO_RETURN: 'NO_RETURN' };
// Motivo de "não retorna" — o mesmo valor vai pra vehicles.operation_status.
const NO_RETURN_REASONS = ['SOLD', 'TRANSFERRED_BRANCH', 'TRANSFERRED_HQ'];
const VEHICLE_TYPE_FLEET = 2;
const VEHICLE_ACTIVE = 'ACTIVE';

function mapDbError(err) {
  // Corrida entre duas saídas do mesmo veículo: a checagem do service passou
  // nas duas, o índice único parcial barra a segunda.
  if (err.code === UNIQUE_VIOLATION && err.constraint === 'idx_fleet_logs_vehicle_on_trip') {
    return new AppError('Este veículo já tem uma saída em aberto', 409);
  }
  if (err.code === CHECK_VIOLATION) {
    return new AppError('Dados inconsistentes (verifique KM, combustível ou datas informadas)', 400);
  }
  return err;
}

// KM da frota é sempre obrigatório (saída e retorno), salvo "KM indisponível".
function parseRequiredKm(value, isUnavailable, label) {
  return resolveKm(value, { unavailable: isUnavailable, required: true, label });
}

function toDTO(log) {
  if (!log) return null;
  return {
    id: log.id,
    vehicleId: log.vehicle_id,
    driverId: log.driver_id,
    transportingVehicleId: log.transporting_vehicle_id,
    transportedByPlate: log.transported_by_plate,
    transportLogId: log.transport_log_id,
    carriedVehiclePlate: log.carried_vehicle_plate,
    noReturnReason: log.no_return_reason,
    destination: log.destination,
    purpose: decryptField(log.purpose_encrypted),
    departureTime: log.departure_time,
    departureGateId: log.departure_gate_id,
    departureOperatorId: log.departure_operator_id,
    returnTime: log.return_time,
    returnGateId: log.return_gate_id,
    returnOperatorId: log.return_operator_id,
    isKmUnavailable: log.is_km_unavailable,
    kmDeparture: log.km_departure,
    kmReturn: log.km_return,
    fuelLevelDeparture: log.fuel_level_departure,
    fuelLevelReturn: log.fuel_level_return,
    status: log.status,
    observation: decryptField(log.observation_encrypted),
    createdAt: log.created_at,
    updatedAt: log.updated_at,
  };
}

/**
 * `search` (?search=, "placa, motorista ou destino"): placa e motorista não
 * são colunas de fleet_logs (são vehicle_id/driver_id) — resolve primeiro
 * quais veículos/pessoas batem (vehiclesService/peopleService.searchIds),
 * igual ao mesmo problema em access-logs. `destination`, ao contrário,
 * É uma coluna de texto livre de fleet_logs, então entra direto como ILIKE
 * — por isso não dá pra usar o mesmo atalho "sem match, retorna vazio" do
 * access-logs (destino pode bater mesmo sem nenhum motorista/veículo).
 */
async function list(companyId, { page, limit, status, vehicleId, from, to, search } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const filters = {
    status: status || undefined,
    vehicleId: vehicleId !== undefined ? Number(vehicleId) : undefined,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  };

  if (search && search.trim()) {
    const term = search.trim();
    const [driverIds, vehicleIds] = await Promise.all([
      peopleService.searchIds(companyId, term),
      vehiclesService.searchIds(companyId, term),
    ]);
    filters.driverIds = driverIds;
    filters.vehicleIds = vehicleIds;
    filters.destinationTerm = term;
  }

  const [rows, totalRow] = await Promise.all([
    repository.listByCompany(companyId, { limit: safeLimit, offset, ...filters }),
    repository.countByCompany(companyId, filters),
  ]);

  return {
    data: await withRelated(companyId, rows.map(toDTO)),
    pagination: { page: safePage, limit: safeLimit, total: Number(totalRow.count) },
  };
}

async function listOnTrip(companyId) {
  const rows = await repository.listOnTripByCompany(companyId);
  return { data: await withRelated(companyId, rows.map(toDTO)) };
}

async function getById(companyId, id) {
  const log = await repository.findByIdAndCompany(id, companyId);
  if (!log) {
    throw new AppError('Registro de frota não encontrado', 404);
  }
  const [dto] = await withRelated(companyId, [toDTO(log)]);
  return dto;
}

function parseNoReturnReason(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (!NO_RETURN_REASONS.includes(value)) {
    throw new AppError(`${label}: motivo de não retorno inválido (use ${NO_RETURN_REASONS.join(', ')})`, 400);
  }
  return value;
}

function formatDepartureDate(value) {
  return new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Veículo que vai sair (rodando ou em cima do guincho): da frota própria,
 * não bloqueado, não vendido/transferido e sem outra saída em aberto.
 */
async function assertFleetVehicleCanLeave(companyId, vehicleId, label) {
  const vehicle = await assertBelongsToCompany(
    vehiclesRepository,
    vehicleId,
    companyId,
    `${label}: veículo não encontrado nesta empresa`
  );
  if (vehicle.vehicle_type !== VEHICLE_TYPE_FLEET) {
    throw new AppError(`${label}: o veículo precisa estar cadastrado como Frota Própria`, 400);
  }
  if (vehicle.is_blocked) {
    throw new AppError(
      `${label} bloqueado: ${decryptField(vehicle.block_reason_encrypted) || 'sem motivo informado'}`,
      403
    );
  }
  if (vehicle.operation_status && vehicle.operation_status !== VEHICLE_ACTIVE) {
    throw new AppError(
      `${label}: marcado como vendido/transferido — um administrador pode reativá-lo em Cadastros > Veículos`,
      409
    );
  }
  const openTrip = await repository.findOnTripByVehicle(companyId, vehicleId);
  if (openTrip) {
    throw new AppError(
      `${label}: já está fora (saída em ${formatDepartureDate(openTrip.departure_time)}). ` +
        'Registre o retorno antes de uma nova saída.',
      409
    );
  }
  return vehicle;
}

/**
 * Saída de um veículo da frota — sempre com motorista (quem vai dirigindo).
 * Se ele é um guincho levando outro veículo:
 * - `carriedVehicleId` (da frota): cria também o registro do veículo levado
 *   em cima (sem motorista, ligado a este por transport_log_id), que fica na
 *   rua até voltar — em outro momento, rodando;
 * - `carriedVehiclePlate` (terceiro): só a placa, neste registro.
 * `noReturnReason` / `carriedNoReturnReason`: vendido ou transferido — o
 * registro já nasce finalizado (NO_RETURN) e o cadastro do veículo fica
 * marcado, sem novas saídas até um admin reativar.
 */
async function registerDeparture(auth, payload) {
  const { companyId } = auth;
  const {
    vehicleId,
    driverId,
    carriedVehicleId,
    carriedVehiclePlate,
    carriedNoReturnReason,
    noReturnReason,
    destination,
    purpose,
    departureGateId,
    kmDeparture,
    isKmUnavailable,
    fuelLevelDeparture,
    observation,
  } = payload;

  if (!vehicleId || !departureGateId) {
    throw new AppError('vehicleId e departureGateId são obrigatórios', 400);
  }
  if (!driverId) {
    throw new AppError('Informe o motorista do veículo', 400);
  }
  if (carriedVehicleId && carriedVehiclePlate) {
    throw new AppError('Informe carriedVehicleId ou carriedVehiclePlate, não os dois', 400);
  }
  if (carriedVehicleId && Number(carriedVehicleId) === Number(vehicleId)) {
    throw new AppError('O veículo transportado não pode ser o próprio guincho', 400);
  }
  const mainNoReturn = parseNoReturnReason(noReturnReason, 'Veículo');
  const carriedNoReturn = parseNoReturnReason(carriedNoReturnReason, 'Veículo transportado');
  if (carriedNoReturn && !carriedVehicleId) {
    throw new AppError('carriedNoReturnReason só vale para veículo transportado da frota', 400);
  }
  const carriedPlate = carriedVehiclePlate ? normalizePlate(carriedVehiclePlate) : null;
  if (carriedVehiclePlate && (!carriedPlate || carriedPlate.length > 10)) {
    throw new AppError('Placa do veículo transportado inválida', 400);
  }

  const kmUnavailable = Boolean(isKmUnavailable);
  const kmDepartureValue = parseRequiredKm(kmDeparture, kmUnavailable, 'KM de saída');

  await assertFleetVehicleCanLeave(companyId, Number(vehicleId), 'Veículo');
  if (carriedVehicleId) {
    await assertFleetVehicleCanLeave(companyId, Number(carriedVehicleId), 'Veículo transportado');
  }

  const driver = await assertBelongsToCompany(
    peopleRepository,
    Number(driverId),
    companyId,
    'driverId inválido: pessoa não encontrada nesta empresa'
  );
  if (driver.is_blocked) {
    throw new AppError(`Motorista bloqueado: ${decryptField(driver.block_reason_encrypted) || 'sem motivo informado'}`, 403);
  }
  if (driver.anonymized_at) {
    throw new AppError('Motorista anonimizado (LGPD) não pode ser usado em um registro novo', 400);
  }

  await assertBelongsToCompany(
    gatesRepository,
    Number(departureGateId),
    companyId,
    'departureGateId inválido: portão não encontrado nesta empresa'
  );

  const purposeText = purpose === undefined ? null : parseOptionalText(purpose, 'Motivo');
  // O odômetro do veículo levado em cima não anda: a saída dele herda o
  // último KM conhecido (a volta, rodando, é conferida contra esse valor).
  const carriedLastKm = carriedVehicleId
    ? await repository.findLastKnownKm(companyId, Number(carriedVehicleId))
    : null;

  try {
    const log = await withAuthTransaction(auth, async (trx) => {
      const departureTime = new Date();
      const main = await repository.insert(
        {
          company_id: companyId,
          vehicle_id: Number(vehicleId),
          driver_id: Number(driverId),
          carried_vehicle_plate: carriedPlate,
          destination: destination || null,
          purpose_encrypted: encryptField(purposeText),
          departure_time: departureTime,
          departure_gate_id: Number(departureGateId),
          departure_operator_id: auth.userId,
          km_departure: kmDepartureValue,
          is_km_unavailable: kmUnavailable,
          fuel_level_departure: fuelLevelDeparture !== undefined ? Number(fuelLevelDeparture) : null,
          observation_encrypted: encryptField(observation || null),
          status: mainNoReturn ? STATUS.NO_RETURN : STATUS.ON_TRIP,
          no_return_reason: mainNoReturn,
        },
        trx
      );
      if (mainNoReturn) {
        await vehiclesRepository.update(Number(vehicleId), companyId, { operation_status: mainNoReturn }, trx);
      }

      if (carriedVehicleId) {
        await repository.insert(
          {
            company_id: companyId,
            vehicle_id: Number(carriedVehicleId),
            driver_id: null,
            transporting_vehicle_id: Number(vehicleId),
            transport_log_id: main.id,
            destination: destination || null,
            purpose_encrypted: encryptField(purposeText),
            departure_time: departureTime,
            departure_gate_id: Number(departureGateId),
            departure_operator_id: auth.userId,
            km_departure: carriedLastKm ? Number(carriedLastKm.km) : null,
            is_km_unavailable: false,
            status: carriedNoReturn ? STATUS.NO_RETURN : STATUS.ON_TRIP,
            no_return_reason: carriedNoReturn,
          },
          trx
        );
        if (carriedNoReturn) {
          await vehiclesRepository.update(Number(carriedVehicleId), companyId, { operation_status: carriedNoReturn }, trx);
        }
      }
      return main;
    });
    return toDTO(log);
  } catch (err) {
    throw mapDbError(err);
  }
}

/**
 * Último KM conhecido do veículo (retorno da última viagem, ou a saída se ela
 * ainda não voltou / voltou sem KM) — usado pra pré-preencher e conferir o KM
 * de saída da próxima viagem. `lastKm: null` quando nunca houve KM registrado.
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

async function registerReturn(auth, id, payload) {
  const { companyId } = auth;
  const log = await repository.findByIdAndCompany(id, companyId);
  if (!log) {
    throw new AppError('Registro de frota não encontrado', 404);
  }
  if (log.status !== STATUS.ON_TRIP || log.return_time) {
    throw new AppError('Este registro já foi finalizado', 409);
  }

  const { returnGateId, kmReturn, isKmUnavailable, fuelLevelReturn, observation } = payload;
  if (!returnGateId) {
    throw new AppError('returnGateId é obrigatório', 400);
  }

  const kmUnavailable = Boolean(isKmUnavailable);
  const kmReturnValue = parseRequiredKm(kmReturn, kmUnavailable, 'KM de retorno');
  // Estritamente maior: um veículo que foi e voltou rodou pelo menos 1 km.
  // Igual à saída é quase sempre o operador repetindo o número. Sem KM de
  // saída registrado (indisponível, ou registro anterior à obrigatoriedade)
  // não há com o que comparar.
  if (kmReturnValue !== null && log.km_departure !== null && kmReturnValue <= log.km_departure) {
    throw new AppError(
      `KM de retorno deve ser maior que o KM de saída (${log.km_departure}). ` +
        'Se o painel do veículo não está legível, marque "KM indisponível".',
      400
    );
  }

  await assertBelongsToCompany(
    gatesRepository,
    Number(returnGateId),
    companyId,
    'returnGateId inválido: portão não encontrado nesta empresa'
  );

  const changes = {
    return_time: new Date(),
    return_gate_id: Number(returnGateId),
    return_operator_id: auth.userId,
    status: STATUS.RETURNED,
  };
  changes.km_return = kmReturnValue;
  // Só liga o flag: se a saída já foi marcada como indisponível, o retorno
  // com KM válido não pode desligar isso.
  if (kmUnavailable) changes.is_km_unavailable = true;
  if (fuelLevelReturn !== undefined) changes.fuel_level_return = Number(fuelLevelReturn);
  if (observation !== undefined) changes.observation_encrypted = encryptField(observation || null);

  try {
    const updated = await withAuthTransaction(auth, (trx) => repository.update(id, companyId, changes, trx));
    return toDTO(updated);
  } catch (err) {
    throw mapDbError(err);
  }
}

// destination/purpose têm até 255 caracteres (purpose é validado aqui, no
// texto em claro — a coluna cifrada é TEXT): texto vazio vira null.
function parseOptionalText(value, label) {
  if (value === null) return null;
  const text = String(value).trim();
  if (text.length > 255) {
    throw new AppError(`${label} pode ter no máximo 255 caracteres`, 400);
  }
  return text || null;
}

/**
 * Correção de um registro de frota (só admin — ver routes): veículo e
 * motorista (troca por outro cadastro — corrigir o cadastro em si é em
 * Cadastros), KM de saída/retorno, flag "KM indisponível", destino, motivo
 * e datas de saída/retorno.
 * Atualização parcial (campo ausente = mantém). Mesmas regras da saída/
 * retorno: KM sempre obrigatório salvo "KM indisponível", retorno
 * estritamente maior que a saída. O antes/depois fica na Auditoria.
 */
async function updateLog(auth, id, payload) {
  const { companyId } = auth;
  const log = await repository.findByIdAndCompany(id, companyId);
  if (!log) {
    throw new AppError('Registro de frota não encontrado', 404);
  }

  const has = (field) => payload[field] !== undefined;
  const hasReturned = Boolean(log.return_time);
  if (!hasReturned && (has('kmReturn') || has('returnTime'))) {
    throw new AppError(
      'Este veículo ainda não retornou: registre o retorno pelo fluxo normal antes de editar KM ou data de retorno',
      400
    );
  }

  const changes = {};
  if (has('driverId')) {
    // O registro do veículo levado em cima do guincho não tem motorista.
    if (log.transport_log_id) {
      throw new AppError('Veículo transportado em cima do guincho não tem motorista', 400);
    }
    if (!payload.driverId) {
      throw new AppError('Informe o motorista do veículo', 400);
    }
    const driver = await assertBelongsToCompany(
      peopleRepository,
      Number(payload.driverId),
      companyId,
      'driverId inválido: pessoa não encontrada nesta empresa'
    );
    if (driver.anonymized_at) {
      throw new AppError('Motorista anonimizado (LGPD) não pode ser usado', 400);
    }
    changes.driver_id = Number(payload.driverId);
  }
  // Troca do veículo (indicado errado na saída). Com a viagem em aberto, o
  // índice idx_fleet_logs_vehicle_on_trip barra um veículo que já está fora.
  if (has('vehicleId') && Number(payload.vehicleId) !== log.vehicle_id) {
    const vehicle = await assertBelongsToCompany(
      vehiclesRepository,
      Number(payload.vehicleId),
      companyId,
      'vehicleId inválido: veículo não encontrado nesta empresa'
    );
    if (vehicle.vehicle_type !== VEHICLE_TYPE_FLEET) {
      throw new AppError('O veículo precisa estar cadastrado como Frota Própria', 400);
    }
    if (log.transporting_vehicle_id && vehicle.id === log.transporting_vehicle_id) {
      throw new AppError('O veículo transportado não pode ser o próprio guincho', 400);
    }
    changes.vehicle_id = vehicle.id;
  }
  if (has('destination')) changes.destination = parseOptionalText(payload.destination, 'Destino');
  if (has('purpose')) changes.purpose_encrypted = encryptField(parseOptionalText(payload.purpose, 'Motivo'));

  if (has('departureTime') || has('returnTime')) {
    const departureTime = has('departureTime')
      ? parseEditTimestamp(payload.departureTime, 'Data de saída')
      : log.departure_time;
    const returnTime = has('returnTime') ? parseEditTimestamp(payload.returnTime, 'Data de retorno') : log.return_time;
    if (returnTime && new Date(returnTime) < new Date(departureTime)) {
      throw new AppError('Data de retorno não pode ser anterior à data de saída', 400);
    }
    if (has('departureTime')) changes.departure_time = departureTime;
    if (has('returnTime')) changes.return_time = returnTime;
  }

  // KM só é revalidado quando a edição mexe em KM: registros antigos (de
  // antes da obrigatoriedade) podem ter o destino corrigido sem exigir KM.
  if (has('kmDeparture') || has('kmReturn') || has('isKmUnavailable')) {
    const unavailable = has('isKmUnavailable') ? Boolean(payload.isKmUnavailable) : Boolean(log.is_km_unavailable);
    // O flag é do registro inteiro: aqui ele só dispensa a obrigatoriedade,
    // sem apagar números já informados.
    const required = !unavailable;

    const kmDeparture = resolveKm(has('kmDeparture') ? payload.kmDeparture : log.km_departure, {
      required,
      label: 'KM de saída',
    });
    const kmReturn = hasReturned
      ? resolveKm(has('kmReturn') ? payload.kmReturn : log.km_return, { required, label: 'KM de retorno' })
      : null;
    if (kmReturn !== null && kmDeparture !== null && kmReturn <= kmDeparture) {
      throw new AppError(
        `KM de retorno (${kmReturn}) deve ser maior que o KM de saída (${kmDeparture}). ` +
          'Se o painel do veículo não está legível, marque "KM indisponível".',
        400
      );
    }

    changes.km_departure = kmDeparture;
    if (hasReturned) changes.km_return = kmReturn;
    changes.is_km_unavailable = unavailable;
  }

  if (Object.keys(changes).length === 0) {
    return toDTO(log);
  }

  try {
    const updated = await withAuthTransaction(auth, async (trx) => {
      const row = await repository.update(id, companyId, changes, trx);
      // Guincho trocado: os veículos levados em cima apontam pro novo.
      if (changes.vehicle_id) {
        await repository.updateCarriedTransportingVehicle(id, companyId, changes.vehicle_id, trx);
      }
      return row;
    });
    return toDTO(updated);
  } catch (err) {
    throw mapDbError(err);
  }
}

async function listAllForDriver(companyId, driverId) {
  const rows = await repository.listAllByDriver(companyId, driverId);
  return withRelated(companyId, rows.map(toDTO));
}

module.exports = {
  list,
  listOnTrip,
  getById,
  getLastKm,
  registerDeparture,
  registerReturn,
  updateLog,
  listAllForDriver,
};
