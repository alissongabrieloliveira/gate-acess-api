const gatesService = require('./gates.service');

async function list(req, res, next) {
  try {
    const result = await gatesService.list(req.auth.companyId, req.query);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const gate = await gatesService.getById(req.auth.companyId, Number(req.params.id));
    return res.status(200).json(gate);
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const gate = await gatesService.create(req.auth, req.body || {});
    return res.status(201).json(gate);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const gate = await gatesService.update(req.auth, Number(req.params.id), req.body || {});
    return res.status(200).json(gate);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, create, update };
