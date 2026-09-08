const AppError = require('../../utils/AppError');
const repository = require('./users.repository');
const { generateBindex } = require('../../utils/bindex');
const { hashPassword } = require('../../utils/password');
const { encryptField, decryptField } = require('../../utils/crypto');
const { isValidCpf } = require('../../utils/cpf');
const RULES = require('../../config/rules');

const UNIQUE_VIOLATION = '23505';

// Diferente de people (CPF opcional), aqui o CPF é obrigatório — mas a
// checagem de validade é a mesma checagem em si (cpf_encrypted também é
// criptografado, sem CHECK constraint possível no Postgres).
function assertValidCpf(cpf) {
  if (!isValidCpf(cpf)) {
    throw new AppError('CPF inválido', 400);
  }
}

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
    mustChangePassword: user.must_change_password,
    emailVerifiedAt: user.email_verified_at,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

// Compartilhado com o branch `search` de list() — nome/e-mail comparados
// como substring, CPF como dígitos contidos no termo buscado.
function matchesSearch(user, term, digitsTerm) {
  if (user.name?.toLowerCase().includes(term)) return true;
  if (user.email?.toLowerCase().includes(term)) return true;
  if (!digitsTerm) return false;
  return user.cpf?.includes(digitsTerm);
}

/**
 * Busca por nome/CPF/e-mail (?search=): assim como em people, essas colunas
 * são *_encrypted — sem ILIKE possível no banco. Decripta todos os usuários
 * da empresa, filtra em memória e só então pagina o resultado já filtrado,
 * pra achar o usuário em qualquer página (não só a já carregada no
 * cliente). Aceitável pro volume de operadores de uma portaria (bem menor
 * que o de people/vehicles).
 */
async function list(companyId, { page, limit, search } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);

  if (search && search.trim()) {
    const term = search.trim().toLowerCase();
    const digitsTerm = term.replace(/\D/g, '');

    const rows = await repository.listAllByCompany(companyId);
    const matched = rows.map(toDTO).filter((user) => matchesSearch(user, term, digitsTerm));

    const offset = (safePage - 1) * safeLimit;
    return {
      data: matched.slice(offset, offset + safeLimit),
      pagination: { page: safePage, limit: safeLimit, total: matched.length },
    };
  }

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
  assertValidCpf(cpf);

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
      // A senha definida aqui é sempre temporária: só o admin a conhece, e o
      // usuário é obrigado a trocá-la antes de usar o sistema (decisão de
      // segurança — admin não deve deter a senha de uso contínuo de
      // ninguém). Ver update() abaixo: só o próprio usuário pode alterar
      // senha depois de criado.
      must_change_password: true,
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

  // Nem admin pode definir a senha de outro usuário (só na criação, como
  // senha temporária) — evita que um admin conheça/redefina a senha de uso
  // contínuo de alguém e consiga logar como essa pessoa sem ela saber.
  if (payload.password !== undefined && !isSelf) {
    throw new AppError('Somente o próprio usuário pode alterar sua senha', 403);
  }

  const changes = {};

  if (payload.name !== undefined) changes.name_encrypted = encryptField(payload.name);
  if (payload.cpf !== undefined) {
    assertValidCpf(payload.cpf);
    changes.cpf_encrypted = encryptField(payload.cpf);
    changes.cpf_bindex = generateBindex(payload.cpf);
  }
  if (payload.email !== undefined) {
    changes.email_encrypted = encryptField(payload.email);
    changes.email_bindex = generateBindex(payload.email);
  }
  if (payload.password !== undefined) {
    changes.password_hash = await hashPassword(payload.password);
    // Qualquer troca de senha feita pelo próprio usuário (inclusive a
    // primeira, trocando a senha temporária do admin) encerra a exigência.
    changes.must_change_password = false;
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
