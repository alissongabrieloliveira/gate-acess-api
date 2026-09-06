const AppError = require('../../utils/AppError');
const repository = require('./vehicles.repository');
const withAuthTransaction = require('../../utils/withAuthTransaction');

const UNIQUE_VIOLATION = '23505';

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
    createdAt: vehicle.created_at,
    updatedAt: vehicle.updated_at,
  };
}

/** Busca exata por placa (query param `plate`) — útil para checar na portaria se um
 * veículo já está cadastrado/bloqueado antes de duplicar, sem paginar tudo. */
async function list(companyId, { page, limit, vehicleType, operationStatus, plate } = {}) {
  if (plate) {
    const vehicle = await repository.findByPlate(normalizePlate(plate), companyId);
    return {
      data: vehicle ? [toDTO(vehicle)] : [],
      pagination: { page: 1, limit: 1, total: vehicle ? 1 : 0 },
    };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const parsedType = vehicleType !== undefined ? Number(vehicleType) : undefined;

  const [rows, totalRow] = await Promise.all([
    repository.listByCompany(companyId, { limit: safeLimit, offset, vehicleType: parsedType, operationStatus }),
    repository.countByCompany(companyId, { vehicleType: parsedType, operationStatus }),
  ]);

  return {
    data: rows.map(toDTO),
    pagination: { page: safePage, limit: safeLimit, total: Number(totalRow.count) },
  };
}

async function getById(companyId, id) {
  const vehicle = await repository.findByIdAndCompany(id, companyId);
  if (!vehicle) {
    throw new AppError('Veículo não encontrado', 404);
  }
  return toDTO(vehicle);
}

async function create(auth, { vehicleType, licensePlate, brand, model, color }) {
  if (!licensePlate) {
    throw new AppError('Placa é obrigatória', 400);
  }

  try {
    const vehicle = await withAuthTransaction(auth, (trx) =>
      repository.insert(
        {
          company_id: auth.companyId,
          vehicle_type: Number.isInteger(vehicleType) ? vehicleType : 1,
          license_plate: normalizePlate(licensePlate),
          brand: brand || null,
          model: model || null,
          color: color || null,
        },
        trx
      )
    );
    return toDTO(vehicle);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw new AppError('Já existe um veículo com essa placa nesta empresa', 409);
    }
    throw err;
  }
}

async function update(auth, id, payload) {
  const changes = {};

  if (payload.vehicleType !== undefined) changes.vehicle_type = Number(payload.vehicleType);
  if (payload.licensePlate !== undefined) changes.license_plate = normalizePlate(payload.licensePlate);
  if (payload.brand !== undefined) changes.brand = payload.brand || null;
  if (payload.model !== undefined) changes.model = payload.model || null;
  if (payload.color !== undefined) changes.color = payload.color || null;
  if (payload.operationStatus !== undefined) changes.operation_status = payload.operationStatus;

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
    if (err.code === UNIQUE_VIOLATION) {
      throw new AppError('Já existe um veículo com essa placa nesta empresa', 409);
    }
    throw err;
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

module.exports = { list, getById, create, update, setBlocked, setPhoto, normalizePlate };
