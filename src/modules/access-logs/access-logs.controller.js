const accessLogsService = require('./access-logs.service');

async function list(req, res, next) {
  try {
    const result = await accessLogsService.list(req.auth.companyId, req.query);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function listActive(req, res, next) {
  try {
    const result = await accessLogsService.listActive(req.auth.companyId);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const log = await accessLogsService.getById(req.auth.companyId, Number(req.params.id));
    return res.status(200).json(log);
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const log = await accessLogsService.registerEntry(req.auth.companyId, req.auth.userId, req.body || {});
    return res.status(201).json(log);
  } catch (err) {
    return next(err);
  }
}

async function exit(req, res, next) {
  try {
    const log = await accessLogsService.registerExit(
      req.auth.companyId,
      req.auth.userId,
      Number(req.params.id),
      req.body || {}
    );
    return res.status(200).json(log);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, listActive, getById, create, exit };
