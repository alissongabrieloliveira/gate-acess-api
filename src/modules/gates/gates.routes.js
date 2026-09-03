const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const authorize = require('../../middlewares/authorize');
const RULES = require('../../config/rules');
const controller = require('./gates.controller');

const router = Router();

router.use(authenticate);

// Leitura aberta a qualquer operador (precisa escolher o portão em telas de
// entrada/saída). claude.md agrupa "portões" na área admin do frontend — criar e
// editar exige RULES.ADMIN.
router.get('/', controller.list);
router.get('/:id', controller.getById);
router.post('/', authorize(RULES.ADMIN), controller.create);
router.put('/:id', authorize(RULES.ADMIN), controller.update);

module.exports = router;
