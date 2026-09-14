const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const authorize = require('../../middlewares/authorize');
const RULES = require('../../config/rules');
const controller = require('./gateway-config.controller');

const router = Router();

router.use(authenticate);
router.use(authorize(RULES.ADMIN));

router.get('/', controller.getConfig);
router.post('/device', controller.createDevice);
router.post('/device/revoke', controller.revokeDevice);
router.post('/outputs', controller.createOutput);
router.put('/outputs/:id', controller.updateOutput);
router.delete('/outputs/:id', controller.deleteOutput);

module.exports = router;
