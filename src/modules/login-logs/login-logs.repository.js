const db = require('../../config/db');

const COLUMNS = ['id', 'company_id', 'user_id', 'login_time', 'ip_address', 'user_agent', 'status'];

function applyFilters(query, { userId, status, from, to }) {
  if (userId !== undefined) query.andWhere({ user_id: userId });
  if (status) query.andWhere({ status });
  if (from) query.andWhere('login_time', '>=', from);
  if (to) query.andWhere('login_time', '<=', to);
  return query;
}

function listByCompany(companyId, { limit, offset, ...filters }) {
  const query = db('login_logs')
    .select(COLUMNS)
    .where({ company_id: companyId })
    .orderBy('login_time', 'desc')
    .limit(limit)
    .offset(offset);
  return applyFilters(query, filters);
}

function countByCompany(companyId, filters) {
  const query = db('login_logs').where({ company_id: companyId }).count('id as count');
  return applyFilters(query, filters).first();
}

module.exports = { listByCompany, countByCompany };
