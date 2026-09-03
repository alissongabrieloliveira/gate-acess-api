const auditLogsService = require('./audit-logs.service');

async function list(req, res, next) {
  try {
    const result = await auditLogsService.list(req.auth.companyId, req.query);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const log = await auditLogsService.getById(req.auth.companyId, Number(req.params.id));
    return res.status(200).json(log);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById };
