const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const authorize = require('../../middlewares/authorize');
const RULES = require('../../config/rules');
const controller = require('./users.controller');
const dataExportController = require('../data-export/data-export.controller');

const router = Router();

router.use(authenticate);

router.get('/', authorize(RULES.ADMIN), controller.list);
router.post('/', authorize(RULES.ADMIN), controller.create);
// getById/update: admin ou o próprio usuário (checado no controller/service).
router.get('/:id', controller.getById);
router.patch('/:id', controller.update);
router.delete('/:id', authorize(RULES.ADMIN), controller.remove);
// Exportação de dados do titular (LGPD): admin ou o próprio usuário
// (checado no service); a exportação fica registrada na Auditoria.
router.get('/:id/data-export', dataExportController.exportUser);

module.exports = router;
