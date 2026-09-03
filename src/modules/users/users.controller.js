const usersService = require('./users.service');

async function list(req, res, next) {
  try {
    const result = await usersService.list(req.auth.companyId, req.query);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!usersService.isAdmin(req.auth) && req.auth.userId !== id) {
      return res.status(403).json({ error: 'Permissão insuficiente' });
    }
    const user = await usersService.getById(req.auth.companyId, id);
    return res.status(200).json(user);
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const user = await usersService.create(req.auth.companyId, req.body || {});
    return res.status(201).json(user);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    const user = await usersService.update(req.auth.companyId, id, req.auth, req.body || {});
    return res.status(200).json(user);
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const id = Number(req.params.id);
    await usersService.remove(req.auth.companyId, id, req.auth);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, create, update, remove };
