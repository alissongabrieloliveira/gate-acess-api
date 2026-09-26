const dataExportService = require('./data-export.service');

async function exportPerson(req, res, next) {
  try {
    const result = await dataExportService.exportPersonData(req.auth, Number(req.params.id));
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = { exportPerson };
