const db = require('../../config/db');

const DEVICE_COLUMNS = ['id', 'company_id', 'name', 'last_seen_at', 'created_at', 'revoked_at'];
const OUTPUT_COLUMNS = ['id', 'company_id', 'gateway_device_id', 'direction', 'output_number', 'host', 'port', 'ns', 'current_state'];

function findActiveDeviceByCompany(companyId, trx = db) {
  return trx('gateway_devices').select(DEVICE_COLUMNS).where({ company_id: companyId }).whereNull('revoked_at').first();
}

async function insertDevice(data, trx = db) {
  const [row] = await trx('gateway_devices').insert(data).returning(DEVICE_COLUMNS);
  return row;
}

async function revokeDevice(id, companyId, trx = db) {
  const [row] = await trx('gateway_devices')
    .where({ id, company_id: companyId })
    .whereNull('revoked_at')
    .update({ revoked_at: trx.fn.now() })
    .returning(DEVICE_COLUMNS);
  return row;
}

// Usado ao provisionar um device novo (substituindo um revogado) — mantém
// a fiação das saídas já configuradas em vez de forçar recriar tudo.
function reassignOutputsToDevice(companyId, newDeviceId, trx = db) {
  return trx('gate_direction_outputs').where({ company_id: companyId }).update({ gateway_device_id: newDeviceId });
}

function listOutputsByCompany(companyId, trx = db) {
  return trx('gate_direction_outputs').select(OUTPUT_COLUMNS).where({ company_id: companyId }).orderBy(['direction', 'output_number']);
}

function findOutputByIdAndCompany(id, companyId, trx = db) {
  return trx('gate_direction_outputs').select(OUTPUT_COLUMNS).where({ id, company_id: companyId }).first();
}

async function insertOutput(data, trx = db) {
  const [row] = await trx('gate_direction_outputs').insert(data).returning(OUTPUT_COLUMNS);
  return row;
}

async function updateOutput(id, companyId, data, trx = db) {
  const [row] = await trx('gate_direction_outputs').where({ id, company_id: companyId }).update(data).returning(OUTPUT_COLUMNS);
  return row;
}

function deleteOutput(id, companyId, trx = db) {
  return trx('gate_direction_outputs').where({ id, company_id: companyId }).del();
}

module.exports = {
  findActiveDeviceByCompany,
  insertDevice,
  revokeDevice,
  reassignOutputsToDevice,
  listOutputsByCompany,
  findOutputByIdAndCompany,
  insertOutput,
  updateOutput,
  deleteOutput,
};
