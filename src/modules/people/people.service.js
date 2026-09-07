const AppError = require('../../utils/AppError');
const repository = require('./people.repository');
const { generateBindex } = require('../../utils/bindex');
const { encryptField, decryptField } = require('../../utils/crypto');
const withAuthTransaction = require('../../utils/withAuthTransaction');

const UNIQUE_VIOLATION = '23505';

// 1=Visitante, 2=Prestador, 3=Funcionário (gate_schema.sql).
const PERSON_TYPES = { VISITOR: 1, CONTRACTOR: 2, EMPLOYEE: 3 };
const VALID_PERSON_TYPES = Object.values(PERSON_TYPES);

function toDTO(person) {
  if (!person) return null;
  return {
    id: person.id,
    personType: person.person_type,
    name: decryptField(person.name_encrypted),
    cpf: person.cpf_encrypted ? decryptField(person.cpf_encrypted) : null,
    rg: person.rg_encrypted ? decryptField(person.rg_encrypted) : null,
    phone: person.phone_encrypted ? decryptField(person.phone_encrypted) : null,
    photoUrl: person.photo_url,
    isBlocked: person.is_blocked,
    blockReason: person.block_reason,
    createdAt: person.created_at,
    updatedAt: person.updated_at,
  };
}

function assertValidPersonType(personType) {
  if (personType !== undefined && !VALID_PERSON_TYPES.includes(personType)) {
    throw new AppError('person_type inválido (use 1=Visitante, 2=Prestador, 3=Funcionário)', 400);
  }
}

/**
 * Busca direta por CPF (query param `cpf`) vira um lookup por cpf_bindex — o mesmo
 * padrão do login — em vez de decriptar toda a lista para filtrar. Útil na portaria
 * para checar se um visitante já está cadastrado/bloqueado antes de criar duplicata.
 */
async function list(companyId, { page, limit, personType, cpf } = {}) {
  if (cpf) {
    const person = await repository.findByCpfBindex(generateBindex(cpf), companyId);
    return {
      data: person ? [toDTO(person)] : [],
      pagination: { page: 1, limit: 1, total: person ? 1 : 0 },
    };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const parsedType = personType !== undefined ? Number(personType) : undefined;
  assertValidPersonType(parsedType);

  const [rows, totalRow] = await Promise.all([
    repository.listByCompany(companyId, { limit: safeLimit, offset, personType: parsedType }),
    repository.countByCompany(companyId, { personType: parsedType }),
  ]);

  return {
    data: rows.map(toDTO),
    pagination: { page: safePage, limit: safeLimit, total: Number(totalRow.count) },
  };
}

async function getById(companyId, id) {
  const person = await repository.findByIdAndCompany(id, companyId);
  if (!person) {
    throw new AppError('Pessoa não encontrada', 404);
  }
  return toDTO(person);
}

async function create(auth, { personType, name, cpf, rg, phone, photoUrl }) {
  if (!name) {
    throw new AppError('Nome é obrigatório', 400);
  }

  const type = personType !== undefined ? Number(personType) : PERSON_TYPES.VISITOR;
  assertValidPersonType(type);

  try {
    const person = await withAuthTransaction(auth, (trx) =>
      repository.insert(
        {
          company_id: auth.companyId,
          person_type: type,
          name_encrypted: encryptField(name),
          cpf_encrypted: cpf ? encryptField(cpf) : null,
          rg_encrypted: rg ? encryptField(rg) : null,
          cpf_bindex: cpf ? generateBindex(cpf) : null,
          phone_encrypted: phone ? encryptField(phone) : null,
          photo_url: photoUrl || null,
        },
        trx
      )
    );
    return toDTO(person);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw new AppError('Já existe uma pessoa cadastrada com esse CPF nesta empresa', 409);
    }
    throw err;
  }
}

async function update(auth, id, payload) {
  const changes = {};

  if (payload.personType !== undefined) {
    const type = Number(payload.personType);
    assertValidPersonType(type);
    changes.person_type = type;
  }
  if (payload.name !== undefined) changes.name_encrypted = encryptField(payload.name);
  if (payload.cpf !== undefined) {
    changes.cpf_encrypted = payload.cpf ? encryptField(payload.cpf) : null;
    changes.cpf_bindex = payload.cpf ? generateBindex(payload.cpf) : null;
  }
  if (payload.rg !== undefined) changes.rg_encrypted = payload.rg ? encryptField(payload.rg) : null;
  if (payload.phone !== undefined) changes.phone_encrypted = payload.phone ? encryptField(payload.phone) : null;
  if (payload.photoUrl !== undefined) changes.photo_url = payload.photoUrl;

  if (Object.keys(changes).length === 0) {
    throw new AppError('Nenhum campo para atualizar foi enviado', 400);
  }

  try {
    const person = await withAuthTransaction(auth, (trx) => repository.update(id, auth.companyId, changes, trx));
    if (!person) {
      throw new AppError('Pessoa não encontrada', 404);
    }
    return toDTO(person);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw new AppError('Já existe uma pessoa cadastrada com esse CPF nesta empresa', 409);
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

  const person = await withAuthTransaction(auth, (trx) =>
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
  if (!person) {
    throw new AppError('Pessoa não encontrada', 404);
  }
  return toDTO(person);
}

async function setPhoto(auth, id, photoUrl) {
  const person = await withAuthTransaction(auth, (trx) =>
    repository.update(id, auth.companyId, { photo_url: photoUrl }, trx)
  );
  if (!person) {
    throw new AppError('Pessoa não encontrada', 404);
  }
  return toDTO(person);
}

module.exports = { list, getById, create, update, setBlocked, setPhoto, PERSON_TYPES };
