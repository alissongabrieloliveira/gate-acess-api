const AppError = require('../../utils/AppError');
const repository = require('./vehicles.repository');
const withAuthTransaction = require('../../utils/withAuthTransaction');

const UNIQUE_VIOLATION = '23505';

// Placa e código de identificação são dois índices únicos parciais
// diferentes (ver migrations) — o nome do índice violado (`err.constraint`)
// diz qual dos dois, pra devolver uma mensagem específica em vez de sempre
// assumir que foi a placa.
function mapUniqueViolation(err) {
  if (err.code !== UNIQUE_VIOLATION) return err;
  if (err.constraint === 'idx_vehicles_identification_unique') {
    return new AppError('Já existe um veículo com essa identificação nesta empresa', 409);
  }
  return new AppError('Já existe um veículo com essa placa nesta empresa', 409);
}

// 1=Visitante, 2=Frota Própria, 3=Colaborador, 4=Prestador de Serviço
// (definido pelo usuário — gate_schema.sql não trazia uma enumeração formal
// pra esse campo, só o default 1).
const VEHICLE_TYPES = { VISITOR: 1, OWN_FLEET: 2, EMPLOYEE: 3, CONTRACTOR: 4 };
const VALID_VEHICLE_TYPES = Object.values(VEHICLE_TYPES);

function assertValidVehicleType(vehicleType) {
  if (vehicleType !== undefined && !VALID_VEHICLE_TYPES.includes(vehicleType)) {
    throw new AppError(
      'vehicle_type inválido (use 1=Visitante, 2=Frota Própria, 3=Colaborador, 4=Prestador de Serviço)',
      400
    );
  }
}

/**
 * gate_schema.sql: "Salvo em letras maiúsculas e sem traço no backend" — não há
 * trigger de normalização no banco (diferente do CNPJ de companies), então isso
 * precisa acontecer aqui antes de gravar/consultar, senão "ABC-1234" e "ABC1234"
 * seriam tratados como placas diferentes pelo índice único.
 */
function normalizePlate(plate) {
  return String(plate).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function toDTO(vehicle) {
  if (!vehicle) return null;
  return {
    id: vehicle.id,
    vehicleType: vehicle.vehicle_type,
    licensePlate: vehicle.license_plate,
    brand: vehicle.brand,
    model: vehicle.model,
    color: vehicle.color,
    operationStatus: vehicle.operation_status,
    isBlocked: vehicle.is_blocked,
    blockReason: vehicle.block_reason,
    photoUrl: vehicle.photo_url,
    identificationCode: vehicle.identification_code,
    createdAt: vehicle.created_at,
    updatedAt: vehicle.updated_at,
  };
}

/** Busca exata por placa (query param `plate`) ou por código de identificação
 * (query param `identification`) — útil para checar na portaria se um veículo
 * já está cadastrado/bloqueado antes de duplicar, ou pra achar rápido um
 * veículo de frota própria pelo número interno, sem paginar tudo. */
async function list(companyId, { page, limit, vehicleType, operationStatus, plate, identification, search } = {}) {
  if (plate) {
    const vehicle = await repository.findByPlate(normalizePlate(plate), companyId);
    return {
      data: vehicle ? [toDTO(vehicle)] : [],
      pagination: { page: 1, limit: 1, total: vehicle ? 1 : 0 },
    };
  }

  if (identification) {
    const vehicle = await repository.findByIdentificationCode(identification, companyId);
    return {
      data: vehicle ? [toDTO(vehicle)] : [],
      pagination: { page: 1, limit: 1, total: vehicle ? 1 : 0 },
    };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const parsedType = vehicleType !== undefined ? Number(vehicleType) : undefined;
  assertValidVehicleType(parsedType);
  const searchTerm = search?.trim() || undefined;

  const [rows, totalRow] = await Promise.all([
    repository.listByCompany(companyId, {
      limit: safeLimit,
      offset,
      vehicleType: parsedType,
      operationStatus,
      search: searchTerm,
    }),
    repository.countByCompany(companyId, { vehicleType: parsedType, operationStatus, search: searchTerm }),
  ]);

  return {
    data: rows.map(toDTO),
    pagination: { page: safePage, limit: safeLimit, total: Number(totalRow.count) },
  };
}

// Resolve ids de veículos cuja placa bate com um termo livre — reaproveitado
// por access-logs/fleet-logs pra buscar "por placa" sem duplicar a lógica de
// comparação (placa fica em claro no banco, então basta ILIKE).
function searchIds(companyId, term) {
  return repository.findIdsByPlateLike(companyId, term);
}

async function getById(companyId, id) {
  const vehicle = await repository.findByIdAndCompany(id, companyId);
  if (!vehicle) {
    throw new AppError('Veículo não encontrado', 404);
  }
  return toDTO(vehicle);
}

async function create(auth, { vehicleType, licensePlate, brand, model, color, identificationCode }) {
  if (!licensePlate) {
    throw new AppError('Placa é obrigatória', 400);
  }

  const type = vehicleType !== undefined ? Number(vehicleType) : VEHICLE_TYPES.VISITOR;
  assertValidVehicleType(type);

  try {
    const vehicle = await withAuthTransaction(auth, (trx) =>
      repository.insert(
        {
          company_id: auth.companyId,
          vehicle_type: type,
          license_plate: normalizePlate(licensePlate),
          brand: brand || null,
          model: model || null,
          color: color || null,
          identification_code: identificationCode?.trim() || null,
        },
        trx
      )
    );
    return toDTO(vehicle);
  } catch (err) {
    throw mapUniqueViolation(err);
  }
}

async function update(auth, id, payload) {
  const changes = {};

  if (payload.vehicleType !== undefined) {
    const type = Number(payload.vehicleType);
    assertValidVehicleType(type);
    changes.vehicle_type = type;
  }
  if (payload.licensePlate !== undefined) changes.license_plate = normalizePlate(payload.licensePlate);
  if (payload.brand !== undefined) changes.brand = payload.brand || null;
  if (payload.model !== undefined) changes.model = payload.model || null;
  if (payload.color !== undefined) changes.color = payload.color || null;
  if (payload.operationStatus !== undefined) changes.operation_status = payload.operationStatus;
  if (payload.identificationCode !== undefined) {
    changes.identification_code = payload.identificationCode?.trim() || null;
  }

  if (Object.keys(changes).length === 0) {
    throw new AppError('Nenhum campo para atualizar foi enviado', 400);
  }

  try {
    const vehicle = await withAuthTransaction(auth, (trx) => repository.update(id, auth.companyId, changes, trx));
    if (!vehicle) {
      throw new AppError('Veículo não encontrado', 404);
    }
    return toDTO(vehicle);
  } catch (err) {
    throw mapUniqueViolation(err);
  }
}

async function setBlocked(auth, id, { isBlocked, reason }) {
  if (isBlocked === undefined) {
    throw new AppError('isBlocked é obrigatório', 400);
  }
  if (isBlocked && !reason) {
    throw new AppError('Motivo do bloqueio é obrigatório', 400);
  }

  const vehicle = await withAuthTransaction(auth, (trx) =>
    repository.update(
      id,
      auth.companyId,
      {
        is_blocked: isBlocked,
        block_reason: isBlocked ? reason : null,
      },
      trx
    )
  );
  if (!vehicle) {
    throw new AppError('Veículo não encontrado', 404);
  }
  return toDTO(vehicle);
}

async function setPhoto(auth, id, photoUrl) {
  const vehicle = await withAuthTransaction(auth, (trx) =>
    repository.update(id, auth.companyId, { photo_url: photoUrl }, trx)
  );
  if (!vehicle) {
    throw new AppError('Veículo não encontrado', 404);
  }
  return toDTO(vehicle);
}

module.exports = { list, getById, create, update, setBlocked, setPhoto, searchIds, normalizePlate, VEHICLE_TYPES };
