const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const authorize = require('../../middlewares/authorize');
const RULES = require('../../config/rules');
const { uploadPersonPhoto } = require('../../middlewares/upload');
const controller = require('./people.controller');
const dataExportController = require('../data-export/data-export.controller');
const anonymizationController = require('../anonymization/anonymization.controller');

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
// Exportação de dados do titular (LGPD): junta todo o histórico da pessoa —
// só admin, e a própria exportação fica registrada na Auditoria.
router.get('/:id/data-export', authorize(RULES.ADMIN), dataExportController.exportPerson);
// Anonimização a pedido do titular (LGPD art. 18) — irreversível, só admin.
router.post('/:id/anonymize', authorize(RULES.ADMIN), anonymizationController.anonymizePerson);

module.exports = router;
