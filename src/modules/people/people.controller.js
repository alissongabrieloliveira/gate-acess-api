const peopleService = require('./people.service');
const { buildPhotoPath } = require('../../middlewares/upload');
const { uploadPhoto: uploadPhotoToStorage } = require('../../utils/supabaseStorage');
const AppError = require('../../utils/AppError');

async function list(req, res, next) {
  try {
    const result = await peopleService.list(req.auth.companyId, req.query);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const person = await peopleService.getById(req.auth.companyId, Number(req.params.id));
    return res.status(200).json(person);
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const person = await peopleService.create(req.auth, req.body || {});
    return res.status(201).json(person);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const person = await peopleService.update(req.auth, Number(req.params.id), req.body || {});
    return res.status(200).json(person);
  } catch (err) {
    return next(err);
  }
}

async function block(req, res, next) {
  try {
    const person = await peopleService.setBlocked(req.auth, Number(req.params.id), req.body || {});
    return res.status(200).json(person);
  } catch (err) {
    return next(err);
  }
}

async function uploadPhoto(req, res, next) {
  try {
    if (!req.file) {
      throw new AppError('Nenhuma imagem enviada', 400);
    }

    const personId = Number(req.params.id);

    // Confirma posse ANTES de subir a foto pro Storage — se a pessoa não
    // existir/não pertencer à empresa, evita deixar um objeto órfão no
    // bucket. Mesmo padrão já usado em vehicles.controller.js.
    await peopleService.getById(req.auth.companyId, personId);

    const photoPath = buildPhotoPath('people', 'person', personId, req.file.mimetype);
    await uploadPhotoToStorage(photoPath, req.file.buffer, req.file.mimetype);

    const person = await peopleService.setPhoto(req.auth, personId, photoPath);

    return res.status(200).json(person);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, create, update, block, uploadPhoto };
