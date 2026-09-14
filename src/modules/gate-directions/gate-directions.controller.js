const service = require('./gate-directions.service');

async function list(req, res, next) {
  try {
    const result = await service.list(req.auth.companyId);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function open(req, res, next) {
  try {
    const result = await service.setDirectionState(req.auth, req.params.direction, 'open');
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function close(req, res, next) {
  try {
    const result = await service.setDirectionState(req.auth, req.params.direction, 'close');
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, open, close };
