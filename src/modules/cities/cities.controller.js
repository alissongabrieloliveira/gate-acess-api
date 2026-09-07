const citiesService = require('./cities.service');

async function list(req, res, next) {
  try {
    const result = await citiesService.list(req.query);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list };
