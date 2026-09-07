const vehiclesService = require('./vehicles.service');
const { buildPhotoPath } = require('../../middlewares/upload');
const { uploadPhoto: uploadPhotoToStorage } = require('../../utils/supabaseStorage');
const AppError = require('../../utils/AppError');

async function list(req, res, next) {
  try {
    const result = await vehiclesService.list(req.auth.companyId, req.query);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const vehicle = await vehiclesService.getById(req.auth.companyId, Number(req.params.id));
    return res.status(200).json(vehicle);
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const vehicle = await vehiclesService.create(req.auth, req.body || {});
    return res.status(201).json(vehicle);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const vehicle = await vehiclesService.update(req.auth, Number(req.params.id), req.body || {});
    return res.status(200).json(vehicle);
  } catch (err) {
    return next(err);
  }
}

async function block(req, res, next) {
  try {
    const vehicle = await vehiclesService.setBlocked(req.auth, Number(req.params.id), req.body || {});
    return res.status(200).json(vehicle);
  } catch (err) {
    return next(err);
  }
}

async function uploadPhoto(req, res, next) {
  try {
    if (!req.file) {
      throw new AppError('Nenhuma imagem enviada', 400);
    }

    const vehicleId = Number(req.params.id);

    // Confirma posse ANTES de subir a foto pro Storage — se o veículo não
    // existir/não pertencer à empresa, evita deixar um objeto órfão no
    // bucket.
    await vehiclesService.getById(req.auth.companyId, vehicleId);

    const photoPath = buildPhotoPath('vehicles', 'vehicle', vehicleId, req.file.mimetype);
    await uploadPhotoToStorage(photoPath, req.file.buffer, req.file.mimetype);

    const vehicle = await vehiclesService.setPhoto(req.auth, vehicleId, photoPath);

    return res.status(200).json(vehicle);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, create, update, block, uploadPhoto };
