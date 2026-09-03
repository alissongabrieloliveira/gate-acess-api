const peopleService = require('./people.service');

async function list(req, res, next) {
  try {
    const result = await peopleService.list(req.auth.companyId, req.query);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const person = await peopleService.getById(req.auth.companyId, Number(req.params.id));
    return res.status(200).json(person);
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const person = await peopleService.create(req.auth, req.body || {});
    return res.status(201).json(person);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const person = await peopleService.update(req.auth, Number(req.params.id), req.body || {});
    return res.status(200).json(person);
  } catch (err) {
    return next(err);
  }
}

async function block(req, res, next) {
  try {
    const person = await peopleService.setBlocked(req.auth, Number(req.params.id), req.body || {});
    return res.status(200).json(person);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, create, update, block };
