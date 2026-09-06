const vehiclesService = require('./vehicles.service');
const { deleteUploadedFile } = require('../../middlewares/upload');
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

    // Confirma posse ANTES de gravar a nova foto — se o veículo não existir/
    // não pertencer à empresa, o arquivo que o multer já escreveu em disco
    // fica órfão, então é apagado aqui antes de propagar o 404.
    let previous;
    try {
      previous = await vehiclesService.getById(req.auth.companyId, vehicleId);
    } catch (err) {
      deleteUploadedFile(req.file.path);
      throw err;
    }

    const photoUrl = `/uploads/vehicles/${req.file.filename}`;
    const vehicle = await vehiclesService.setPhoto(req.auth, vehicleId, photoUrl);

    if (previous.photoUrl) {
      deleteUploadedFile(previous.photoUrl);
    }

    return res.status(200).json(vehicle);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, create, update, block, uploadPhoto };
