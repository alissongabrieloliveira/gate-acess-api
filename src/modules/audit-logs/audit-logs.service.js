const AppError = require('../../utils/AppError');
const repository = require('./audit-logs.repository');

function toDTO(log) {
  if (!log) return null;
  return {
    id: log.id,
    userId: log.user_id,
    tableName: log.table_name,
    recordId: log.record_id,
    action: log.action,
    changedAt: log.changed_at,
    // Só presentes quando vem de findByIdAndCompany (detalhe). old_data/new_data são
    // snapshots da linha (row_to_json) — em tabelas com campos *_encrypted, o valor
    // ali é o texto cifrado (base64), não o dado em claro. É proposital (LGPD: não
    // duplicar dado sensível em claro na trilha de auditoria), não um bug.
    ...(log.old_data !== undefined ? { oldData: log.old_data } : {}),
    ...(log.new_data !== undefined ? { newData: log.new_data } : {}),
  };
}

async function list(companyId, { page, limit, tableName, recordId, action, userId, from, to } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const filters = {
    tableName: tableName || undefined,
    recordId: recordId !== undefined ? Number(recordId) : undefined,
    action: action || undefined,
    userId: userId !== undefined ? Number(userId) : undefined,
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

async function getById(companyId, id) {
  const log = await repository.findByIdAndCompany(id, companyId);
  if (!log) {
    throw new AppError('Registro de auditoria não encontrado', 404);
  }
  return toDTO(log);
}

module.exports = { list, getById };
