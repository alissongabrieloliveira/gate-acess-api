const AppError = require('../../utils/AppError');
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
 * cadastrado e portões, buscados em lote — ver access-logs.service#withRelated.
 */
async function withRelated(companyId, dtos) {
  const [vehicles, people, gates] = await Promise.all([
    vehiclesService.summariesByIds(companyId, dtos.flatMap((d) => [d.vehicleId, d.transportingVehicleId])),
    peopleService.summariesByIds(companyId, dtos.map((d) => d.driverId)),
    namesByIds(gatesRepository, companyId, dtos.flatMap((d) => [d.departureGateId, d.returnGateId])),
  ]);
  return dtos.map((d) => ({
    ...d,
    vehicle: vehicles.get(d.vehicleId) ?? null,
    driver: d.driverId ? (people.get(d.driverId) ?? null) : null,
    transportingVehicle: d.transportingVehicleId ? (vehicles.get(d.transportingVehicleId) ?? null) : null,
    departureGate: gates.get(d.departureGateId) ?? null,
    returnGate: d.returnGateId ? (gates.get(d.returnGateId) ?? null) : null,
  }));
}

const CHECK_VIOLATION = '23514';
const STATUS = { ON_TRIP: 'ON_TRIP', RETURNED: 'RETURNED' };

function mapDbError(err) {
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
    destination: log.destination,
    purpose: log.purpose,
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
    observation: log.observation,
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

async function registerDeparture(auth, payload) {
  const { companyId } = auth;
  const {
    vehicleId,
    driverId,
    transportingVehicleId,
    transportedByPlate,
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

  const kmUnavailable = Boolean(isKmUnavailable);
  const kmDepartureValue = parseRequiredKm(kmDeparture, kmUnavailable, 'KM de saída');

  const vehicle = await assertBelongsToCompany(
    vehiclesRepository,
    Number(vehicleId),
    companyId,
    'vehicleId inválido: veículo não encontrado nesta empresa'
  );
  if (vehicle.is_blocked) {
    throw new AppError(`Veículo bloqueado: ${vehicle.block_reason || 'sem motivo informado'}`, 403);
  }

  if (driverId !== undefined && driverId !== null) {
    const driver = await assertBelongsToCompany(
      peopleRepository,
      Number(driverId),
      companyId,
      'driverId inválido: pessoa não encontrada nesta empresa'
    );
    if (driver.is_blocked) {
      throw new AppError(`Motorista bloqueado: ${driver.block_reason || 'sem motivo informado'}`, 403);
    }
  }

  if (transportingVehicleId !== undefined && transportingVehicleId !== null) {
    if (Number(transportingVehicleId) === Number(vehicleId)) {
      throw new AppError('transportingVehicleId não pode ser o mesmo veículo transportado', 400);
    }
    if (transportedByPlate) {
      throw new AppError('Informe transportingVehicleId ou transportedByPlate, não os dois', 400);
    }
    await assertBelongsToCompany(
      vehiclesRepository,
      Number(transportingVehicleId),
      companyId,
      'transportingVehicleId inválido: veículo não encontrado nesta empresa'
    );
  }

  await assertBelongsToCompany(
    gatesRepository,
    Number(departureGateId),
    companyId,
    'departureGateId inválido: portão não encontrado nesta empresa'
  );

  try {
    const log = await withAuthTransaction(auth, (trx) =>
      repository.insert(
        {
          company_id: companyId,
          vehicle_id: Number(vehicleId),
          driver_id: driverId ? Number(driverId) : null,
          transporting_vehicle_id: transportingVehicleId ? Number(transportingVehicleId) : null,
          transported_by_plate: transportedByPlate ? normalizePlate(transportedByPlate) : null,
          destination: destination || null,
          purpose: purpose || null,
          departure_gate_id: Number(departureGateId),
          departure_operator_id: auth.userId,
          km_departure: kmDepartureValue,
          is_km_unavailable: kmUnavailable,
          fuel_level_departure: fuelLevelDeparture !== undefined ? Number(fuelLevelDeparture) : null,
          observation: observation || null,
        },
        trx
      )
    );
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
  if (observation !== undefined) changes.observation = observation;

  try {
    const updated = await withAuthTransaction(auth, (trx) => repository.update(id, companyId, changes, trx));
    return toDTO(updated);
  } catch (err) {
    throw mapDbError(err);
  }
}

// destination/purpose são VARCHAR(255): texto vazio vira null.
function parseOptionalText(value, label) {
  if (value === null) return null;
  const text = String(value).trim();
  if (text.length > 255) {
    throw new AppError(`${label} pode ter no máximo 255 caracteres`, 400);
  }
  return text || null;
}

/**
 * Correção de um registro de frota (só admin — ver routes): KM de saída/
 * retorno, flag "KM indisponível", destino, motivo e datas de saída/retorno.
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
  if (has('destination')) changes.destination = parseOptionalText(payload.destination, 'Destino');
  if (has('purpose')) changes.purpose = parseOptionalText(payload.purpose, 'Motivo');

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
    const updated = await withAuthTransaction(auth, (trx) => repository.update(id, companyId, changes, trx));
    return toDTO(updated);
  } catch (err) {
    throw mapDbError(err);
  }
}

module.exports = { list, listOnTrip, getById, getLastKm, registerDeparture, registerReturn, updateLog };
