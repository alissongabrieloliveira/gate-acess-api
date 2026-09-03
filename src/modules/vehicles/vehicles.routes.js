const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const controller = require('./vehicles.controller');

const router = Router();

// Sem authorize(ADMIN): mesmo critério de people — cadastro de veículos é operação
// do dia a dia da portaria, qualquer operador autenticado da empresa gerencia.
router.use(authenticate);

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.getById);
router.put('/:id', controller.update);
router.patch('/:id/block', controller.block);

module.exports = router;
