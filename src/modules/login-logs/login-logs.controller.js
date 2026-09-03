const loginLogsService = require('./login-logs.service');

async function list(req, res, next) {
  try {
    const result = await loginLogsService.list(req.auth.companyId, req.query);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list };
