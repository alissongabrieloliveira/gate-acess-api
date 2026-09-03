const db = require('../../config/db');

// Lista sem old_data/new_data (podem ser snapshots grandes da linha inteira) — só a
// detalhe (findByIdAndCompany) traz o payload completo.
const LIST_COLUMNS = ['id', 'company_id', 'user_id', 'table_name', 'record_id', 'action', 'changed_at'];
const DETAIL_COLUMNS = [...LIST_COLUMNS, 'old_data', 'new_data'];

function applyFilters(query, { tableName, recordId, action, userId, from, to }) {
  if (tableName) query.andWhere({ table_name: tableName });
  if (recordId !== undefined) query.andWhere({ record_id: recordId });
  if (action) query.andWhere({ action });
  if (userId !== undefined) query.andWhere({ user_id: userId });
  if (from) query.andWhere('changed_at', '>=', from);
  if (to) query.andWhere('changed_at', '<=', to);
  return query;
}

function listByCompany(companyId, { limit, offset, ...filters }) {
  const query = db('audit_logs')
    .select(LIST_COLUMNS)
    .where({ company_id: companyId })
    .orderBy('changed_at', 'desc')
    .limit(limit)
    .offset(offset);
  return applyFilters(query, filters);
}

function countByCompany(companyId, filters) {
  const query = db('audit_logs').where({ company_id: companyId }).count('id as count');
  return applyFilters(query, filters).first();
}

function findByIdAndCompany(id, companyId) {
  return db('audit_logs').select(DETAIL_COLUMNS).where({ id, company_id: companyId }).first();
}

module.exports = { listByCompany, countByCompany, findByIdAndCompany };
