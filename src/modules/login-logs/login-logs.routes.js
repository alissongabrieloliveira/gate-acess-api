const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const authorize = require('../../middlewares/authorize');
const RULES = require('../../config/rules');
const controller = require('./login-logs.controller');

const router = Router();

// Mesmo critério de audit-logs: só leitura, só admin.
router.use(authenticate, authorize(RULES.ADMIN));

router.get('/', controller.list);

module.exports = router;
