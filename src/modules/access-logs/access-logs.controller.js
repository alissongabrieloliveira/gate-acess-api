const accessLogsService = require('./access-logs.service');
const { buildPhotoPath } = require('../../middlewares/upload');
const { uploadPhoto: uploadPhotoToStorage } = require('../../utils/supabaseStorage');
const AppError = require('../../utils/AppError');

async function list(req, res, next) {
  try {
    const result = await accessLogsService.list(req.auth.companyId, req.query);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function listActive(req, res, next) {
  try {
    const result = await accessLogsService.listActive(req.auth.companyId);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const log = await accessLogsService.getById(req.auth.companyId, Number(req.params.id));
    return res.status(200).json(log);
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const log = await accessLogsService.registerEntry(req.auth, req.body || {});
    return res.status(201).json(log);
  } catch (err) {
    return next(err);
  }
}

async function exit(req, res, next) {
  try {
    const log = await accessLogsService.registerExit(req.auth, Number(req.params.id), req.body || {});
    return res.status(200).json(log);
  } catch (err) {
    return next(err);
  }
}

async function uploadPhoto(req, res, next) {
  try {
    if (!req.file) {
      throw new AppError('Nenhuma imagem enviada', 400);
    }

    const logId = Number(req.params.id);

    // Confirma posse ANTES de subir a foto pro Storage — evita deixar um
    // objeto órfão no bucket se o registro não existir/não for desta
    // empresa. Mesmo padrão de people.controller.js/vehicles.controller.js.
    await accessLogsService.getById(req.auth.companyId, logId);

    const photoPath = buildPhotoPath('access-logs', 'access-log', logId, req.file.mimetype);
    await uploadPhotoToStorage(photoPath, req.file.buffer, req.file.mimetype);

    const log = await accessLogsService.setPhoto(req.auth, logId, photoPath);

    return res.status(200).json(log);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, listActive, getById, create, exit, uploadPhoto };
