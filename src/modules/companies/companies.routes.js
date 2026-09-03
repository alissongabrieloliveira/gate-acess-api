const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const controller = require('./companies.controller');

const router = Router();

router.get('/me', authenticate, controller.getMe);

module.exports = router;
