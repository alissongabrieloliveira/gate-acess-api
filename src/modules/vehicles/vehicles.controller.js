const vehiclesService = require('./vehicles.service');

async function list(req, res, next) {
  try {
    const result = await vehiclesService.list(req.auth.companyId, req.query);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const vehicle = await vehiclesService.getById(req.auth.companyId, Number(req.params.id));
    return res.status(200).json(vehicle);
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const vehicle = await vehiclesService.create(req.auth.companyId, req.body || {});
    return res.status(201).json(vehicle);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const vehicle = await vehiclesService.update(req.auth.companyId, Number(req.params.id), req.body || {});
    return res.status(200).json(vehicle);
  } catch (err) {
    return next(err);
  }
}

async function block(req, res, next) {
  try {
    const vehicle = await vehiclesService.setBlocked(req.auth.companyId, Number(req.params.id), req.body || {});
    return res.status(200).json(vehicle);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, create, update, block };
