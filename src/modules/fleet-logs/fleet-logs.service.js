const AppError = require('../../utils/AppError');
const assertBelongsToCompany = require('../../utils/assertBelongsToCompany');
const withAuthTransaction = require('../../utils/withAuthTransaction');
const repository = require('./fleet-logs.repository');
const peopleRepository = require('../people/people.repository');
const vehiclesRepository = require('../vehicles/vehicles.repository');
const gatesRepository = require('../gates/gates.repository');
const { normalizePlate } = require('../vehicles/vehicles.service');

const CHECK_VIOLATION = '23514';
const STATUS = { ON_TRIP: 'ON_TRIP', RETURNED: 'RETURNED' };

function mapDbError(err) {
  if (err.code === CHECK_VIOLATION) {
    return new AppError('Dados inconsistentes (verifique KM, combustível ou datas informadas)', 400);
  }
  return err;
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

async function list(companyId, { page, limit, status, vehicleId, from, to } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const filters = {
    status: status || undefined,
    vehicleId: vehicleId !== undefined ? Number(vehicleId) : undefined,
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
          km_departure: kmDeparture !== undefined ? Number(kmDeparture) : null,
          is_km_unavailable: Boolean(isKmUnavailable),
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
  if (kmReturn !== undefined) changes.km_return = Number(kmReturn);
  if (isKmUnavailable !== undefined) changes.is_km_unavailable = Boolean(isKmUnavailable);
  if (fuelLevelReturn !== undefined) changes.fuel_level_return = Number(fuelLevelReturn);
  if (observation !== undefined) changes.observation = observation;

  try {
    const updated = await withAuthTransaction(auth, (trx) => repository.update(id, companyId, changes, trx));
    return toDTO(updated);
  } catch (err) {
    throw mapDbError(err);
  }
}

module.exports = { list, listOnTrip, getById, registerDeparture, registerReturn };
