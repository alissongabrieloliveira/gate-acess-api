const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const authorize = require('../../middlewares/authorize');
const RULES = require('../../config/rules');
const controller = require('./companies.controller');

const router = Router();

router.get('/me', authenticate, controller.getMe);
// Só admin edita os dados da própria empresa — mesmo critério de
// gates/sectors (leitura aberta, escrita admin-only).
router.put('/me', authenticate, authorize(RULES.ADMIN), controller.updateMe);

module.exports = router;
