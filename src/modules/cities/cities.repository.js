const db = require('../../config/db');

const COLUMNS = ['id', 'name', 'state_abbr', 'ibge_code'];

// Busca ignora maiúsculas e acentos ("propicio" acha "Vila Propício"): o
// nome passa por lower() + translate() no banco e o termo é normalizado igual
// aqui. translate() em vez da extensão unaccent pra não depender de instalar
// extensão no Supabase; ~5.570 linhas, varredura sem índice é barata.
const ACCENTED = 'áàâãäéèêëíìîïóòôõöúùûüçñ';
const PLAIN = 'aaaaaeeeeiiiiooooouuuucn';
const NORMALIZED_NAME = `translate(lower(name), '${ACCENTED}', '${PLAIN}')`;

function normalizeTerm(term) {
  return term
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Termo escapado pro LIKE (% e _ digitados valem como texto).
function applySearch(query, search) {
  if (!search) return query;
  const term = normalizeTerm(search).replace(/[\\%_]/g, (c) => `\\${c}`);
  return query.andWhereRaw(`${NORMALIZED_NAME} LIKE ?`, [`%${term}%`]);
}

function baseQuery() {
  return db('cities').select(COLUMNS).whereNull('deleted_at').where({ is_active: true });
}

function listAll({ limit, offset, search }) {
  const query = baseQuery().orderBy('name', 'asc').limit(limit).offset(offset);
  return applySearch(query, search);
}

function count({ search }) {
  const query = db('cities').whereNull('deleted_at').where({ is_active: true }).count('id as count');
  return applySearch(query, search).first();
}

function findById(id) {
  return baseQuery().where({ id }).first();
}

module.exports = { listAll, count, findById };
