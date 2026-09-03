const { Router } = require('express');
const controller = require('./auth.controller');

const router = Router();

router.post('/login', controller.login);
router.post('/refresh', controller.refresh);
router.post('/logout', controller.logout);

module.exports = router;
