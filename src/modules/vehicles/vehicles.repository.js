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
  'block_reason_encrypted',
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

// Busca em lote pelos ids (sem LIMIT) pra montar o resumo exibido junto dos
// registros de acesso/frota. INCLUI soft-deletados: o histórico continua
// mostrando quem passou, mesmo se o cadastro foi removido depois. Sempre
// filtrado pela empresa.
function findByIdsIncludingDeleted(ids, companyId) {
  if (!ids.length) return Promise.resolve([]);
  return db('vehicles').select(COLUMNS).where({ company_id: companyId }).whereIn('id', ids);
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
// Identificação comparada só pelas letras/números ("CM-12", "cm 12" e "CM12"
// batem entre si), igual à placa — que já é gravada sem traço.
const IDENTIFICATION_ALNUM = "regexp_replace(identification_code, '[^a-zA-Z0-9]', '', 'g')";

function onlyAlnum(term) {
  return String(term ?? '').replace(/[^a-zA-Z0-9]/g, '');
}

// Placa OU número de identificação (o mesmo campo de busca serve pros dois).
function wherePlateOrIdentification(qb, alnum) {
  qb.orWhereILike('license_plate', `%${alnum}%`).orWhereRaw(`${IDENTIFICATION_ALNUM} ILIKE ?`, [`%${alnum}%`]);
}

function applySearch(query, search) {
  if (!search) return query;
  const term = `%${search}%`;
  const alnum = onlyAlnum(search);
  return query.andWhere((qb) => {
    if (alnum) wherePlateOrIdentification(qb, alnum);
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

// Usado por access-logs/fleet-logs pra resolver "essa placa/identificação
// bate com o termo buscado?" sem duplicar esses dados em outra tabela —
// retorna só os ids, que entram num WHERE vehicle_id IN (...) na tabela de log.
async function findIdsByPlateLike(companyId, rawTerm) {
  const alnum = onlyAlnum(rawTerm);
  if (!alnum) return [];
  const rows = await db('vehicles')
    .select('id')
    .where({ company_id: companyId })
    .whereNull('deleted_at')
    .andWhere((qb) => wherePlateOrIdentification(qb, alnum));
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
  findByIdsIncludingDeleted,
  findByPlate,
  findByIdentificationCode,
  listByCompany,
  countByCompany,
  findIdsByPlateLike,
  insert,
  update,
};
