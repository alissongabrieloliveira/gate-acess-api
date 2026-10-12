const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const controller = require('./dashboard.controller');

const router = Router();

router.use(authenticate);

// Leitura aberta a qualquer operador, igual às listagens em que o Dashboard
// se baseava antes (access-logs, people, vehicles).
router.get('/summary', controller.summary);
// Aberta a qualquer operador; o service corta o que é só de admin.
router.get('/alerts', controller.alerts);

module.exports = router;
