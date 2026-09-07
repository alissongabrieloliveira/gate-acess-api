const db = require('../../config/db');

const COLUMNS = [
  'id',
  'company_id',
  'person_type',
  'name_encrypted',
  'cpf_encrypted',
  'rg_encrypted',
  'phone_encrypted',
  'photo_url',
  'is_blocked',
  'block_reason',
  'created_at',
  'updated_at',
];

function baseQuery(companyId) {
  return db('people').select(COLUMNS).where({ company_id: companyId }).whereNull('deleted_at');
}

function findByIdAndCompany(id, companyId) {
  return baseQuery(companyId).where({ id }).first();
}

function findByCpfBindex(cpfBindex, companyId) {
  return baseQuery(companyId).where({ cpf_bindex: cpfBindex }).first();
}

// `blocked` filtra por is_blocked (coluna plana, sem criptografia) — usado
// pelo relatório de Pessoas Bloqueadas (ver people.service.js).
function listByCompany(companyId, { limit, offset, personType, blocked }) {
  const query = baseQuery(companyId).orderBy('id', 'asc').limit(limit).offset(offset);
  if (personType !== undefined) query.andWhere({ person_type: personType });
  if (blocked !== undefined) query.andWhere({ is_blocked: blocked });
  return query;
}

// Sem limit/offset: usada pela busca por nome/CPF/telefone (?search=), que
// precisa decriptar e filtrar em memória (name/cpf/phone são colunas
// *_encrypted, não dá pra fazer ILIKE no banco) antes de paginar o
// resultado já filtrado — ver people.service.js.
function listAllByCompany(companyId, { personType, blocked }) {
  const query = baseQuery(companyId).orderBy('id', 'asc');
  if (personType !== undefined) query.andWhere({ person_type: personType });
  if (blocked !== undefined) query.andWhere({ is_blocked: blocked });
  return query;
}

function countByCompany(companyId, { personType, blocked }) {
  const query = db('people').where({ company_id: companyId }).whereNull('deleted_at').count('id as count');
  if (personType !== undefined) query.andWhere({ person_type: personType });
  if (blocked !== undefined) query.andWhere({ is_blocked: blocked });
  return query.first();
}

// trx opcional (default: db): quando informado, permite rodar o INSERT/UPDATE
// dentro de uma transação que já configurou request.jwt.claims via
// withAuthTransaction, para log_audit_event() saber quem fez a alteração.
async function insert(data, trx = db) {
  const [row] = await trx('people').insert(data).returning(COLUMNS);
  return row;
}

async function update(id, companyId, data, trx = db) {
  const [row] = await trx('people')
    .where({ id, company_id: companyId })
    .whereNull('deleted_at')
    .update(data)
    .returning(COLUMNS);
  return row;
}

module.exports = {
  findByIdAndCompany,
  findByCpfBindex,
  listByCompany,
  listAllByCompany,
  countByCompany,
  insert,
  update,
};
