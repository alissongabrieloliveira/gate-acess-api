const db = require('../../config/db');

const COLUMNS = ['id', 'name', 'state_abbr', 'ibge_code'];

function baseQuery() {
  return db('cities').select(COLUMNS).whereNull('deleted_at').where({ is_active: true });
}

// Sem unaccent (exigiria uma extensão nova só pra isso) — busca é
// case-insensitive mas sensível a acento, mesmo trade-off já aceito em
// outras buscas simples deste projeto.
function listAll({ limit, offset, search }) {
  const query = baseQuery().orderBy('name', 'asc').limit(limit).offset(offset);
  if (search) query.andWhere('name', 'ilike', `%${search}%`);
  return query;
}

function count({ search }) {
  const query = db('cities').whereNull('deleted_at').where({ is_active: true }).count('id as count');
  if (search) query.andWhere('name', 'ilike', `%${search}%`);
  return query.first();
}

module.exports = { listAll, count };
