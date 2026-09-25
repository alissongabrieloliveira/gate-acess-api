const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const authorize = require('../../middlewares/authorize');
const RULES = require('../../config/rules');
const { uploadAccessLogPhoto } = require('../../middlewares/upload');
const controller = require('./access-logs.controller');

const router = Router();

router.use(authenticate);

// /active precisa vir ANTES de /:id, senão Express tentaria casar "active" como :id.
router.get('/active', controller.listActive);
router.get('/vehicles/:vehicleId/last-km', controller.lastKm);
router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.getById);
// Corrigir KM/datas/setor/anfitrião de um registro é só admin (histórico
// de acesso é dado sensível); a Auditoria guarda o antes/depois.
router.put('/:id', authorize(RULES.ADMIN), controller.update);
router.patch('/:id/exit', controller.exit);
router.post('/:id/photo', uploadAccessLogPhoto.single('photo'), controller.uploadPhoto);

module.exports = router;
