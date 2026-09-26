const anonymizationService = require('./anonymization.service');

async function anonymizePerson(req, res, next) {
  try {
    const result = await anonymizationService.anonymizePerson(req.auth, Number(req.params.id));
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = { anonymizePerson };
