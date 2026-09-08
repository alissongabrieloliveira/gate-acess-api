const AppError = require('../../utils/AppError');
const repository = require('./people.repository');
const { generateBindex } = require('../../utils/bindex');
const { encryptField, decryptField } = require('../../utils/crypto');
const { isValidCpf } = require('../../utils/cpf');
const withAuthTransaction = require('../../utils/withAuthTransaction');
const { attachSignedPhotoUrls, deletePhoto: deleteStoragePhoto } = require('../../utils/supabaseStorage');

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
    // Ainda é o CAMINHO cru no bucket do Supabase aqui, não uma URL de
    // verdade — só vira URL assinada em singleDTO()/attachSignedPhotoUrls(),
    // chamado por quem devolve o DTO pra fora (list/getById/create/update/
    // setBlocked/setPhoto). Nunca devolver o resultado de toDTO() direto pro
    // controller sem passar por isso.
    photoUrl: person.photo_url,
    isBlocked: person.is_blocked,
    blockReason: person.block_reason,
    createdAt: person.created_at,
    updatedAt: person.updated_at,
  };
}

async function singleDTO(person) {
  const [dto] = await attachSignedPhotoUrls([toDTO(person)]);
  return dto;
}

function assertValidPersonType(personType) {
  if (personType !== undefined && !VALID_PERSON_TYPES.includes(personType)) {
    throw new AppError('person_type inválido (use 1=Visitante, 2=Prestador, 3=Funcionário)', 400);
  }
}

// CPF é opcional (schema aceita pessoa sem CPF — estrangeiro/criança só com
// RG), então só valida quando um valor é informado. cpf_encrypted é
// criptografado, por isso essa checagem não dá pra fazer via CHECK
// constraint no Postgres (diferente do CNPJ de companies) — precisa
// acontecer aqui, antes de encriptar.
function assertValidCpf(cpf) {
  if (cpf && !isValidCpf(cpf)) {
    throw new AppError('CPF inválido', 400);
  }
}

// Compartilhado entre list() (busca paginada) e searchIds() (usado por
// access-logs/fleet-logs pra resolver "essa pessoa bate com o termo
// buscado?"). `term`/`digitsTerm` já vêm normalizados pelo chamador.
function matchesSearch(person, term, digitsTerm) {
  if (person.name?.toLowerCase().includes(term)) return true;
  if (!digitsTerm) return false;
  return person.cpf?.includes(digitsTerm) || person.phone?.includes(digitsTerm);
}

/**
 * Busca direta por CPF (query param `cpf`) vira um lookup por cpf_bindex — o mesmo
 * padrão do login — em vez de decriptar toda a lista para filtrar. Útil na portaria
 * para checar se um visitante já está cadastrado/bloqueado antes de criar duplicata.
 */
async function list(companyId, { page, limit, personType, cpf, search, blocked } = {}) {
  if (cpf) {
    const person = await repository.findByCpfBindex(generateBindex(cpf), companyId);
    return {
      data: person ? await attachSignedPhotoUrls([toDTO(person)]) : [],
      pagination: { page: 1, limit: 1, total: person ? 1 : 0 },
    };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const parsedType = personType !== undefined ? Number(personType) : undefined;
  assertValidPersonType(parsedType);
  // Vem como string de query param ("true"/"false") — só filtra quando
  // informado (usado pelo relatório de Pessoas Bloqueadas, ?blocked=true).
  const parsedBlocked = blocked !== undefined ? blocked === true || blocked === 'true' : undefined;

  // Busca por nome/CPF/telefone (?search=): name/cpf/phone são colunas
  // *_encrypted, então não dá pra fazer ILIKE no banco — busca teria que
  // decriptar mesmo assim. Como a busca precisa achar a pessoa em qualquer
  // página (não só na que já está carregada no cliente), decripta TODAS as
  // pessoas da empresa, filtra em memória e só então pagina o resultado já
  // filtrado. Aceitável pro volume de dados de uma portaria (dezenas a
  // poucas centenas de pessoas por empresa) — ver memoria.md.
  if (search && search.trim()) {
    const term = search.trim().toLowerCase();
    const digitsTerm = term.replace(/\D/g, '');

    const rows = await repository.listAllByCompany(companyId, { personType: parsedType, blocked: parsedBlocked });
    const matched = rows.map(toDTO).filter((person) => matchesSearch(person, term, digitsTerm));

    const offset = (safePage - 1) * safeLimit;
    return {
      data: await attachSignedPhotoUrls(matched.slice(offset, offset + safeLimit)),
      pagination: { page: safePage, limit: safeLimit, total: matched.length },
    };
  }

  const offset = (safePage - 1) * safeLimit;
  const [rows, totalRow] = await Promise.all([
    repository.listByCompany(companyId, { limit: safeLimit, offset, personType: parsedType, blocked: parsedBlocked }),
    repository.countByCompany(companyId, { personType: parsedType, blocked: parsedBlocked }),
  ]);

  return {
    data: await attachSignedPhotoUrls(rows.map(toDTO)),
    pagination: { page: safePage, limit: safeLimit, total: Number(totalRow.count) },
  };
}

async function getById(companyId, id) {
  const person = await repository.findByIdAndCompany(id, companyId);
  if (!person) {
    throw new AppError('Pessoa não encontrada', 404);
  }
  return singleDTO(person);
}

async function create(auth, { personType, name, cpf, rg, phone, photoUrl }) {
  if (!name) {
    throw new AppError('Nome é obrigatório', 400);
  }

  const type = personType !== undefined ? Number(personType) : PERSON_TYPES.VISITOR;
  assertValidPersonType(type);
  assertValidCpf(cpf);

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
    return singleDTO(person);
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
    assertValidCpf(payload.cpf);
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
    return singleDTO(person);
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
  return singleDTO(person);
}

// Busca a linha crua primeiro (não o DTO) pra achar o caminho antigo no
// bucket sem nunca vazar esse caminho interno pra fora da API — o DTO só
// expõe a URL assinada, nunca o caminho cru (ver toDTO() acima). Apagar a
// foto antiga é best-effort (utils/supabaseStorage.js#deletePhoto nunca
// lança), então não bloqueia a troca se falhar.
async function setPhoto(auth, id, photoPath) {
  const existing = await repository.findByIdAndCompany(id, auth.companyId);
  if (!existing) {
    throw new AppError('Pessoa não encontrada', 404);
  }
  if (existing.photo_url) {
    await deleteStoragePhoto(existing.photo_url);
  }

  const person = await withAuthTransaction(auth, (trx) =>
    repository.update(id, auth.companyId, { photo_url: photoPath }, trx)
  );
  return singleDTO(person);
}

// Resolve ids de pessoas (de qualquer tipo) cujo nome/CPF/telefone bate com
// um termo livre — reaproveitado por access-logs (busca por CPF/Nome) e
// fleet-logs (busca por motorista) pra não duplicar a lógica de decriptar +
// comparar. Mesmo custo do branch `search` de list() (decripta todas as
// pessoas da empresa), aceitável pro volume de dados de uma portaria.
async function searchIds(companyId, rawTerm) {
  const term = String(rawTerm ?? '').trim().toLowerCase();
  if (!term) return [];
  const digitsTerm = term.replace(/\D/g, '');

  const rows = await repository.listAllByCompany(companyId, {});
  return rows
    .map(toDTO)
    .filter((person) => matchesSearch(person, term, digitsTerm))
    .map((person) => person.id);
}

module.exports = { list, getById, create, update, setBlocked, setPhoto, searchIds, PERSON_TYPES };
