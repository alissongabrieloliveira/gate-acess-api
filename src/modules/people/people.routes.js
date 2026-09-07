const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const { uploadPersonPhoto } = require('../../middlewares/upload');
const controller = require('./people.controller');

const router = Router();

// Sem authorize(ADMIN): cadastro de pessoas é operação do dia a dia da portaria,
// qualquer operador autenticado da empresa pode gerenciar (mesmo critério das
// policies de RLS de people em gate_schema.sql, que não distinguem por `rules`).
router.use(authenticate);

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.getById);
router.put('/:id', controller.update);
router.patch('/:id/block', controller.block);
router.post('/:id/photo', uploadPersonPhoto.single('photo'), controller.uploadPhoto);

module.exports = router;
