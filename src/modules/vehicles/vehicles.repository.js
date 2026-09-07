const db = require('../../config/db');

const COLUMNS = [
  'id',
  'company_id',
  'vehicle_type',
  'license_plate',
  'brand',
  'model',
  'color',
  'operation_status',
  'is_blocked',
  'block_reason',
  'photo_url',
  'identification_code',
  'created_at',
  'updated_at',
];

function baseQuery(companyId) {
  return db('vehicles').select(COLUMNS).where({ company_id: companyId }).whereNull('deleted_at');
}

function findByIdAndCompany(id, companyId) {
  return baseQuery(companyId).where({ id }).first();
}

function findByPlate(licensePlate, companyId) {
  return baseQuery(companyId).where({ license_plate: licensePlate }).first();
}

function findByIdentificationCode(identificationCode, companyId) {
  return baseQuery(companyId).where({ identification_code: identificationCode }).first();
}

// license_plate/identification_code/brand/model ficam em claro no banco
// (diferente de people) — dá pra fazer ILIKE direto, sem precisar decriptar
// nada. Placa busca pelo valor sem pontuação (armazenado sempre normalizado),
// os outros três campos casam com o termo literal.
function applySearch(query, search) {
  if (!search) return query;
  const term = `%${search}%`;
  const plateDigits = search.replace(/[^a-zA-Z0-9]/g, '');
  return query.andWhere((qb) => {
    if (plateDigits) qb.orWhereILike('license_plate', `%${plateDigits}%`);
    qb.orWhereILike('identification_code', term).orWhereILike('brand', term).orWhereILike('model', term);
  });
}

function listByCompany(companyId, { limit, offset, vehicleType, operationStatus, search }) {
  const query = baseQuery(companyId).orderBy('id', 'asc').limit(limit).offset(offset);
  if (vehicleType !== undefined) query.andWhere({ vehicle_type: vehicleType });
  if (operationStatus !== undefined) query.andWhere({ operation_status: operationStatus });
  return applySearch(query, search);
}

function countByCompany(companyId, { vehicleType, operationStatus, search }) {
  const query = db('vehicles').where({ company_id: companyId }).whereNull('deleted_at').count('id as count');
  if (vehicleType !== undefined) query.andWhere({ vehicle_type: vehicleType });
  if (operationStatus !== undefined) query.andWhere({ operation_status: operationStatus });
  return applySearch(query, search).first();
}

// Usado por access-logs/fleet-logs pra resolver "essa placa bate com o termo
// buscado?" sem duplicar a placa em claro em outra tabela — retorna só os
// ids, que entram num WHERE vehicle_id IN (...) na tabela de log.
async function findIdsByPlateLike(companyId, rawTerm) {
  const plateDigits = String(rawTerm ?? '').replace(/[^a-zA-Z0-9]/g, '');
  if (!plateDigits) return [];
  const rows = await db('vehicles')
    .select('id')
    .where({ company_id: companyId })
    .whereNull('deleted_at')
    .whereILike('license_plate', `%${plateDigits}%`);
  return rows.map((row) => row.id);
}

// trx opcional (default: db): ver withAuthTransaction — permite log_audit_event()
// saber quem fez a alteração.
async function insert(data, trx = db) {
  const [row] = await trx('vehicles').insert(data).returning(COLUMNS);
  return row;
}

async function update(id, companyId, data, trx = db) {
  const [row] = await trx('vehicles')
    .where({ id, company_id: companyId })
    .whereNull('deleted_at')
    .update(data)
    .returning(COLUMNS);
  return row;
}

module.exports = {
  findByIdAndCompany,
  findByPlate,
  findByIdentificationCode,
  listByCompany,
  countByCompany,
  findIdsByPlateLike,
  insert,
  update,
};
