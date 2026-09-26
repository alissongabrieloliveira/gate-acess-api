const db = require('../../config/db');

function findRecordAuditTrail(companyId, tableName, recordId) {
  return db('audit_logs')
    .select('action', 'changed_at', 'old_data', 'new_data')
    .where({ company_id: companyId, table_name: tableName, record_id: recordId })
    .orderBy('changed_at', 'asc');
}

function findCompanyName(companyId) {
  return db('companies').select('corporate_name', 'trade_name', 'cnpj').where({ id: companyId }).first();
}

function findLoginLogs(companyId, userId) {
  return db('login_logs')
    .select('login_time', 'ip_address', 'user_agent', 'status')
    .where({ company_id: companyId, user_id: userId })
    .orderBy('login_time', 'desc');
}

// Sessões (refresh_tokens) são rotacionadas a cada renovação do acesso —
// centenas por operador. O que é dado pessoal ali é IP e navegador, então
// vão agrupados (com contagem e último uso) em vez de linha a linha.
async function findSessionSummary(companyId, userId) {
  const base = () => db('refresh_tokens').where({ company_id: companyId, user_id: userId });
  const grouped = (column) =>
    base()
      .select(`${column} as value`)
      .count('id as count')
      .max('created_at as last')
      .groupBy(column)
      .orderBy('last', 'desc');
  const [totals, ips, userAgents] = await Promise.all([
    base().count('id as count').min('created_at as first').max('created_at as last').first(),
    grouped('ip_address'),
    grouped('user_agent'),
  ]);
  return { totals, ips, userAgents };
}

// O que o operador fez, resumido por tabela e ação — sem o conteúdo dos
// registros (dados de visitantes e outros cadastros são de terceiros).
function findActivitySummary(companyId, userId) {
  return db('audit_logs')
    .select('table_name', 'action')
    .count('id as count')
    .min('changed_at as first')
    .max('changed_at as last')
    .where({ company_id: companyId, user_id: userId })
    .groupBy('table_name', 'action')
    .orderBy(['table_name', 'action']);
}

// A própria exportação entra na Auditoria (quem gerou e quando). Insert
// direto: não é mudança de linha, então nenhum trigger registraria.
function insertExportRecord({ companyId, userId, tableName, recordId }) {
  return db('audit_logs').insert({
    company_id: companyId,
    user_id: userId,
    table_name: tableName,
    record_id: recordId,
    action: 'EXPORT',
  });
}

module.exports = {
  findRecordAuditTrail,
  findCompanyName,
  findLoginLogs,
  findSessionSummary,
  findActivitySummary,
  insertExportRecord,
};
