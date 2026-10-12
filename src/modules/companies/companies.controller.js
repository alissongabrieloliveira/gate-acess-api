const companiesService = require('./companies.service');
const AppError = require('../../utils/AppError');
const { buildPhotoPath } = require('../../middlewares/upload');
const { uploadPhoto: uploadToStorage } = require('../../utils/supabaseStorage');

async function getMe(req, res, next) {
  try {
    const company = await companiesService.getOwnCompany(req.auth.companyId);
    return res.status(200).json(company);
  } catch (err) {
    return next(err);
  }
}

async function updateMe(req, res, next) {
  try {
    const company = await companiesService.updateOwnCompany(req.auth, req.body || {});
    return res.status(200).json(company);
  } catch (err) {
    return next(err);
  }
}

async function uploadLogo(req, res, next) {
  try {
    if (!req.file) {
      throw new AppError('Nenhuma imagem enviada', 400);
    }
    const { companyId } = req.auth;
    const logoPath = buildPhotoPath('companies', 'logo', companyId, req.file.mimetype);
    await uploadToStorage(logoPath, req.file.buffer, req.file.mimetype);
    const company = await companiesService.setLogo(req.auth, logoPath);
    return res.status(200).json(company);
  } catch (err) {
    return next(err);
  }
}

async function removeLogo(req, res, next) {
  try {
    const company = await companiesService.removeLogo(req.auth);
    return res.status(200).json(company);
  } catch (err) {
    return next(err);
  }
}

module.exports = { getMe, updateMe, uploadLogo, removeLogo };
