const AppError = require('../../utils/AppError');
const repository = require('./users.repository');
const { generateBindex } = require('../../utils/bindex');
const { hashPassword } = require('../../utils/password');
const { encryptField, decryptField } = require('../../utils/crypto');
const RULES = require('../../config/rules');

const UNIQUE_VIOLATION = '23505';

function isAdmin(auth) {
  return Boolean(auth.rules & RULES.ADMIN);
}

function toDTO(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: decryptField(user.name_encrypted),
    cpf: decryptField(user.cpf_encrypted),
    email: decryptField(user.email_encrypted),
    rules: user.rules,
    isActive: user.is_active,
    emailVerifiedAt: user.email_verified_at,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

async function list(companyId, { page, limit } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const [rows, totalRow] = await Promise.all([
    repository.listByCompany(companyId, { limit: safeLimit, offset }),
    repository.countByCompany(companyId),
  ]);

  return {
    data: rows.map(toDTO),
    pagination: { page: safePage, limit: safeLimit, total: Number(totalRow.count) },
  };
}

async function getById(companyId, id) {
  const user = await repository.findByIdAndCompany(id, companyId);
  if (!user) {
    throw new AppError('Usuário não encontrado', 404);
  }
  return toDTO(user);
}

async function create(companyId, { name, cpf, email, password, rules }) {
  if (!name || !cpf || !email || !password) {
    throw new AppError('Nome, CPF, e-mail e senha são obrigatórios', 400);
  }

  const passwordHash = await hashPassword(password);

  try {
    const user = await repository.insert({
      company_id: companyId,
      name_encrypted: encryptField(name),
      cpf_encrypted: encryptField(cpf),
      email_encrypted: encryptField(email),
      cpf_bindex: generateBindex(cpf),
      email_bindex: generateBindex(email),
      password_hash: passwordHash,
      rules: Number.isInteger(rules) ? rules : 0,
    });
    return toDTO(user);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw new AppError('CPF ou e-mail já cadastrado', 409);
    }
    throw err;
  }
}

async function update(companyId, id, auth, payload) {
  const admin = isAdmin(auth);
  const isSelf = auth.userId === id;

  if (!admin && !isSelf) {
    throw new AppError('Permissão insuficiente', 403);
  }

  const changes = {};

  if (payload.name !== undefined) changes.name_encrypted = encryptField(payload.name);
  if (payload.cpf !== undefined) {
    changes.cpf_encrypted = encryptField(payload.cpf);
    changes.cpf_bindex = generateBindex(payload.cpf);
  }
  if (payload.email !== undefined) {
    changes.email_encrypted = encryptField(payload.email);
    changes.email_bindex = generateBindex(payload.email);
  }
  if (payload.password !== undefined) {
    changes.password_hash = await hashPassword(payload.password);
  }

  if (payload.rules !== undefined || payload.isActive !== undefined) {
    if (!admin) {
      throw new AppError('Somente administradores podem alterar permissões ou status', 403);
    }
    if (payload.rules !== undefined) changes.rules = payload.rules;
    if (payload.isActive !== undefined) changes.is_active = payload.isActive;
  }

  if (Object.keys(changes).length === 0) {
    throw new AppError('Nenhum campo para atualizar foi enviado', 400);
  }

  try {
    const user = await repository.update(id, companyId, changes);
    if (!user) {
      throw new AppError('Usuário não encontrado', 404);
    }
    return toDTO(user);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw new AppError('CPF ou e-mail já cadastrado', 409);
    }
    throw err;
  }
}

async function remove(companyId, id, auth) {
  if (auth.userId === id) {
    throw new AppError('Não é possível remover o próprio usuário', 400);
  }

  const affected = await repository.softDelete(id, companyId);
  if (!affected) {
    throw new AppError('Usuário não encontrado', 404);
  }
}

module.exports = { list, getById, create, update, remove, isAdmin };
