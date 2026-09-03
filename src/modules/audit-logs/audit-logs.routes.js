const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const authorize = require('../../middlewares/authorize');
const RULES = require('../../config/rules');
const controller = require('./audit-logs.controller');

const router = Router();

// Só leitura, e só admin: trilha de auditoria é dado de compliance/segurança
// jurídica (claude.md seção 9), não operação do dia a dia do porteiro.
router.use(authenticate, authorize(RULES.ADMIN));

router.get('/', controller.list);
router.get('/:id', controller.getById);

module.exports = router;
