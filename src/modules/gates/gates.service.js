const AppError = require('../../utils/AppError');
const repository = require('./gates.repository');

const UNIQUE_VIOLATION = '23505';

function parseBoolean(value) {
  if (value === undefined) return undefined;
  return value === true || value === 'true';
}

function toDTO(gate) {
  if (!gate) return null;
  return {
    id: gate.id,
    name: gate.name,
    description: gate.description,
    isActive: gate.is_active,
    createdAt: gate.created_at,
    updatedAt: gate.updated_at,
  };
}

async function list(companyId, { page, limit, isActive } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const parsedActive = parseBoolean(isActive);

  const [rows, totalRow] = await Promise.all([
    repository.listByCompany(companyId, { limit: safeLimit, offset, isActive: parsedActive }),
    repository.countByCompany(companyId, { isActive: parsedActive }),
  ]);

  return {
    data: rows.map(toDTO),
    pagination: { page: safePage, limit: safeLimit, total: Number(totalRow.count) },
  };
}

async function getById(companyId, id) {
  const gate = await repository.findByIdAndCompany(id, companyId);
  if (!gate) {
    throw new AppError('Portão não encontrado', 404);
  }
  return toDTO(gate);
}

async function create(companyId, { name, description, isActive }) {
  if (!name) {
    throw new AppError('Nome é obrigatório', 400);
  }

  try {
    const gate = await repository.insert({
      company_id: companyId,
      name,
      description: description || null,
      is_active: isActive !== undefined ? Boolean(isActive) : true,
    });
    return toDTO(gate);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw new AppError('Já existe um portão com esse nome nesta empresa', 409);
    }
    throw err;
  }
}

async function update(companyId, id, payload) {
  const changes = {};

  if (payload.name !== undefined) changes.name = payload.name;
  if (payload.description !== undefined) changes.description = payload.description || null;
  if (payload.isActive !== undefined) changes.is_active = Boolean(payload.isActive);

  if (Object.keys(changes).length === 0) {
    throw new AppError('Nenhum campo para atualizar foi enviado', 400);
  }

  try {
    const gate = await repository.update(id, companyId, changes);
    if (!gate) {
      throw new AppError('Portão não encontrado', 404);
    }
    return toDTO(gate);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw new AppError('Já existe um portão com esse nome nesta empresa', 409);
    }
    throw err;
  }
}

module.exports = { list, getById, create, update };
