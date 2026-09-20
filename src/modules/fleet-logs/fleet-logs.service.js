const AppError = require('../../utils/AppError');
const assertBelongsToCompany = require('../../utils/assertBelongsToCompany');
const withAuthTransaction = require('../../utils/withAuthTransaction');
const repository = require('./fleet-logs.repository');
const peopleRepository = require('../people/people.repository');
const peopleService = require('../people/people.service');
const vehiclesRepository = require('../vehicles/vehicles.repository');
const vehiclesService = require('../vehicles/vehicles.service');
const gatesRepository = require('../gates/gates.repository');
const { normalizePlate } = vehiclesService;

const CHECK_VIOLATION = '23514';
const STATUS = { ON_TRIP: 'ON_TRIP', RETURNED: 'RETURNED' };
// Teto de sanidade: um odômetro real não passa disso, e valores maiores
// estouram o INT do Postgres (erro 500 em vez de 400).
const MAX_KM = 9999999;

function mapDbError(err) {
  if (err.code === CHECK_VIOLATION) {
    return new AppError('Dados inconsistentes (verifique KM, combustível ou datas informadas)', 400);
  }
  return err;
}

/**
 * KM é obrigatório (saída e retorno), salvo quando o operador marca "KM
 * indisponível" (painel quebrado, sem energia etc.) — aí o campo é ignorado e
 * gravado como NULL, pra nunca coexistir um número com o flag de indisponível.
 * Devolve `null` quando indisponível, senão o KM já validado como inteiro.
 */
function parseRequiredKm(value, isUnavailable, label) {
  if (isUnavailable) return null;
  if (value === undefined || value === null || value === '') {
    throw new AppError(`${label} é obrigatório (ou marque "KM indisponível")`, 400);
  }
  const km = Number(value);
  if (!Number.isInteger(km) || km < 0 || km > MAX_KM) {
    throw new AppError(`${label} inválido: informe um número inteiro entre 0 e ${MAX_KM}`, 400);
  }
  return km;
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
    data: rows.map(toDTO),
    pagination: { page: safePage, limit: safeLimit, total: Number(totalRow.count) },
  };
}

async function listOnTrip(companyId) {
  const rows = await repository.listOnTripByCompany(companyId);
  return { data: rows.map(toDTO) };
}

async function getById(companyId, id) {
  const log = await repository.findByIdAndCompany(id, companyId);
  if (!log) {
    throw new AppError('Registro de frota não encontrado', 404);
  }
  return toDTO(log);
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

module.exports = { list, listOnTrip, getById, getLastKm, registerDeparture, registerReturn };
