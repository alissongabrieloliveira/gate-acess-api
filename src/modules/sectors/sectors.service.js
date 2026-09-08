const AppError = require('../../utils/AppError');
const repository = require('./sectors.repository');
const withAuthTransaction = require('../../utils/withAuthTransaction');

const UNIQUE_VIOLATION = '23505';

function parseBoolean(value) {
  if (value === undefined) return undefined;
  return value === true || value === 'true';
}

function toDTO(sector) {
  if (!sector) return null;
  return {
    id: sector.id,
    name: sector.name,
    description: sector.description,
    isActive: sector.is_active,
    createdAt: sector.created_at,
    updatedAt: sector.updated_at,
  };
}

async function list(companyId, { page, limit, isActive, search } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const parsedActive = parseBoolean(isActive);
  const searchTerm = search?.trim() || undefined;

  const [rows, totalRow] = await Promise.all([
    repository.listByCompany(companyId, { limit: safeLimit, offset, isActive: parsedActive, search: searchTerm }),
    repository.countByCompany(companyId, { isActive: parsedActive, search: searchTerm }),
  ]);

  return {
    data: rows.map(toDTO),
    pagination: { page: safePage, limit: safeLimit, total: Number(totalRow.count) },
  };
}

async function getById(companyId, id) {
  const sector = await repository.findByIdAndCompany(id, companyId);
  if (!sector) {
    throw new AppError('Setor não encontrado', 404);
  }
  return toDTO(sector);
}

async function create(auth, { name, description, isActive }) {
  if (!name) {
    throw new AppError('Nome é obrigatório', 400);
  }

  try {
    const sector = await withAuthTransaction(auth, (trx) =>
      repository.insert(
        {
          company_id: auth.companyId,
          name,
          description: description || null,
          is_active: isActive !== undefined ? Boolean(isActive) : true,
        },
        trx
      )
    );
    return toDTO(sector);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw new AppError('Já existe um setor com esse nome nesta empresa', 409);
    }
    throw err;
  }
}

async function update(auth, id, payload) {
  const changes = {};

  if (payload.name !== undefined) changes.name = payload.name;
  if (payload.description !== undefined) changes.description = payload.description || null;
  if (payload.isActive !== undefined) changes.is_active = Boolean(payload.isActive);

  if (Object.keys(changes).length === 0) {
    throw new AppError('Nenhum campo para atualizar foi enviado', 400);
  }

  try {
    const sector = await withAuthTransaction(auth, (trx) => repository.update(id, auth.companyId, changes, trx));
    if (!sector) {
      throw new AppError('Setor não encontrado', 404);
    }
    return toDTO(sector);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw new AppError('Já existe um setor com esse nome nesta empresa', 409);
    }
    throw err;
  }
}

module.exports = { list, getById, create, update };
