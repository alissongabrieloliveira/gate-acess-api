const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const controller = require('./access-logs.controller');

const router = Router();

router.use(authenticate);

// /active precisa vir ANTES de /:id, senão Express tentaria casar "active" como :id.
router.get('/active', controller.listActive);
router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.getById);
router.patch('/:id/exit', controller.exit);

module.exports = router;
