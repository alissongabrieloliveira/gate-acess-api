const db = require('../../config/db');

function findPersonAuditTrail(companyId, personId) {
  return db('audit_logs')
    .select('action', 'changed_at', 'old_data', 'new_data')
    .where({ company_id: companyId, table_name: 'people', record_id: personId })
    .orderBy('changed_at', 'asc');
}

function findCompanyName(companyId) {
  return db('companies').select('corporate_name', 'trade_name', 'cnpj').where({ id: companyId }).first();
}

// A própria exportação entra na Auditoria (quem gerou e quando). Insert
// direto: não é mudança de linha, então nenhum trigger registraria.
function insertExportRecord({ companyId, userId, personId }) {
  return db('audit_logs').insert({
    company_id: companyId,
    user_id: userId,
    table_name: 'people',
    record_id: personId,
    action: 'EXPORT',
  });
}

module.exports = { findPersonAuditTrail, findCompanyName, insertExportRecord };
