const db = require('../../config/db');

const COLUMNS = ['id', 'company_id', 'gateway_device_id', 'direction', 'output_number', 'current_state', 'updated_at'];

function baseQuery(companyId) {
  return db('gate_direction_outputs').select(COLUMNS).where({ company_id: companyId });
}

function listByCompany(companyId) {
  return baseQuery(companyId).orderBy(['direction', 'output_number']);
}

function findByDirectionAndCompany(direction, companyId) {
  return baseQuery(companyId).where({ direction });
}

// trx opcional (default: db): ver withAuthTransaction. A releitura PRECISA
// usar o mesmo `trx` da escrita — usar `db` (fora da transação) aqui
// devolveria o estado ANTERIOR ao commit (bug real encontrado no teste:
// a resposta de /open vinha com currentState ainda 'OFF', porque a leitura
// batia numa conexão que não enxergava a escrita ainda não commitada).
async function updateStateByIds(ids, companyId, state, trx = db) {
  await trx('gate_direction_outputs').whereIn('id', ids).andWhere({ company_id: companyId }).update({ current_state: state });
  return trx('gate_direction_outputs').select(COLUMNS).whereIn('id', ids);
}

module.exports = { listByCompany, findByDirectionAndCompany, updateStateByIds };
