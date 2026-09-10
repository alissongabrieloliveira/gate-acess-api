const db = require('../../config/db');

// LEFT JOIN só pra trazer o nome da cidade (city_name/city_state_abbr) junto —
// companies.state já existe direto na tabela (sincronizado por trigger quando
// city_id está preenchido, ver migration create_companies), mas o nome da
// cidade em si só vive em `cities`.
function baseQuery(trx = db) {
  return trx('companies')
    .leftJoin('cities', 'companies.city_id', 'cities.id')
    .select('companies.*', 'cities.name as city_name', 'cities.state_abbr as city_state_abbr');
}

// trx opcional (default: db) — precisa aceitar trx pra `update()` conseguir
// reler a linha (com o join de cidade) de dentro da MESMA transação da
// escrita, antes do commit (ver withAuthTransaction).
function findById(id, trx = db) {
  return baseQuery(trx).where('companies.id', id).whereNull('companies.deleted_at').first();
}

// Usa withAuthTransaction (ver companies.service.js): `companies` agora tem
// trg_audit_companies (migration add_audit_trigger_to_companies) — sem a
// claim de `request.jwt.claims` configurada na transação, audit_logs.user_id
// gravaria NULL em toda edição, mesmo critério já usado em
// people/vehicles/gates/sectors.
async function update(id, data, trx = db) {
  await trx('companies').where({ id }).whereNull('deleted_at').update(data);
  return findById(id, trx);
}

module.exports = { findById, update };
