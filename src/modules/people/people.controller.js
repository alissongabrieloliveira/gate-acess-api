const peopleService = require('./people.service');
const { deleteUploadedFile } = require('../../middlewares/upload');
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

    // Confirma posse ANTES de gravar a nova foto — se a pessoa não existir/
    // não pertencer à empresa, o arquivo que o multer já escreveu em disco
    // fica órfão, então é apagado aqui antes de propagar o 404. Mesmo padrão
    // já usado em vehicles.controller.js.
    let previous;
    try {
      previous = await peopleService.getById(req.auth.companyId, personId);
    } catch (err) {
      deleteUploadedFile(req.file.path);
      throw err;
    }

    const photoUrl = `/uploads/people/${req.file.filename}`;
    const person = await peopleService.setPhoto(req.auth, personId, photoUrl);

    if (previous.photoUrl) {
      deleteUploadedFile(previous.photoUrl);
    }

    return res.status(200).json(person);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, create, update, block, uploadPhoto };
