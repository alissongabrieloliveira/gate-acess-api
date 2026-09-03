const fleetLogsService = require('./fleet-logs.service');

async function list(req, res, next) {
  try {
    const result = await fleetLogsService.list(req.auth.companyId, req.query);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function listOnTrip(req, res, next) {
  try {
    const result = await fleetLogsService.listOnTrip(req.auth.companyId);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const log = await fleetLogsService.getById(req.auth.companyId, Number(req.params.id));
    return res.status(200).json(log);
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const log = await fleetLogsService.registerDeparture(req.auth, req.body || {});
    return res.status(201).json(log);
  } catch (err) {
    return next(err);
  }
}

async function returnTrip(req, res, next) {
  try {
    const log = await fleetLogsService.registerReturn(req.auth, Number(req.params.id), req.body || {});
    return res.status(200).json(log);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, listOnTrip, getById, create, returnTrip };
