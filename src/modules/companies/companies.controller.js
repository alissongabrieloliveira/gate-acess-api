const companiesService = require('./companies.service');

async function getMe(req, res, next) {
  try {
    const company = await companiesService.getOwnCompany(req.auth.companyId);
    return res.status(200).json(company);
  } catch (err) {
    return next(err);
  }
}

module.exports = { getMe };
