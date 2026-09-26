const dashboardService = require('./dashboard.service');

async function summary(req, res, next) {
  try {
    const result = await dashboardService.summary(req.auth.companyId, req.query);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = { summary };
