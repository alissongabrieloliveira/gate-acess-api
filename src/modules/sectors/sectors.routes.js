const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const authorize = require('../../middlewares/authorize');
const RULES = require('../../config/rules');
const controller = require('./sectors.controller');

const router = Router();

router.use(authenticate);

// Mesmo critério de gates: leitura aberta a qualquer operador (precisa escolher o
// setor de destino ao registrar um acesso), criar/editar exige RULES.ADMIN.
router.get('/', controller.list);
router.get('/:id', controller.getById);
router.post('/', authorize(RULES.ADMIN), controller.create);
router.put('/:id', authorize(RULES.ADMIN), controller.update);

module.exports = router;
