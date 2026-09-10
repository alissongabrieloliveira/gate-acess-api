const db = require('../../config/db');

// LEFT JOIN só pra trazer o nome da cidade (city_name/city_state_abbr) junto —
// companies.state já existe direto na tabela (sincronizado por trigger quando
// city_id está preenchido, ver migration create_companies), mas o nome da
// cidade em si só vive em `cities`.
function baseQuery() {
  return db('companies')
    .leftJoin('cities', 'companies.city_id', 'cities.id')
    .select('companies.*', 'cities.name as city_name', 'cities.state_abbr as city_state_abbr');
}

function findById(id) {
  return baseQuery().where('companies.id', id).whereNull('companies.deleted_at').first();
}

// Sem withAuthTransaction: companies não tem trigger de auditoria (só
// people/vehicles/gates/sectors/access_logs/fleet_logs têm, ver
// memoria.md) — mesmo critério já usado em users.repository.js#update.
async function update(id, data) {
  await db('companies').where({ id }).whereNull('deleted_at').update(data);
  return findById(id);
}

module.exports = { findById, update };
