const service = require('./gateway-config.service');

async function getConfig(req, res, next) {
  try {
    const result = await service.getConfig(req.auth.companyId);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function createDevice(req, res, next) {
  try {
    const result = await service.createDevice(req.auth, req.body?.name);
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

async function revokeDevice(req, res, next) {
  try {
    await service.revokeDevice(req.auth);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

async function createOutput(req, res, next) {
  try {
    const result = await service.createOutput(req.auth, req.body || {});
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

async function updateOutput(req, res, next) {
  try {
    const result = await service.updateOutput(req.auth, Number(req.params.id), req.body || {});
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function deleteOutput(req, res, next) {
  try {
    await service.deleteOutput(req.auth, Number(req.params.id));
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = { getConfig, createDevice, revokeDevice, createOutput, updateOutput, deleteOutput };
