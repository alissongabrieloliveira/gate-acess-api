const repository = require('./login-logs.repository');

function toDTO(log) {
  if (!log) return null;
  return {
    id: log.id,
    userId: log.user_id,
    loginTime: log.login_time,
    ipAddress: log.ip_address,
    userAgent: log.user_agent,
    status: log.status,
  };
}

async function list(companyId, { page, limit, userId, status, from, to } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const filters = {
    userId: userId !== undefined ? Number(userId) : undefined,
    status: status || undefined,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  };

  const [rows, totalRow] = await Promise.all([
    repository.listByCompany(companyId, { limit: safeLimit, offset, ...filters }),
    repository.countByCompany(companyId, filters),
  ]);

  return {
    data: rows.map(toDTO),
    pagination: { page: safePage, limit: safeLimit, total: Number(totalRow.count) },
  };
}

module.exports = { list };
