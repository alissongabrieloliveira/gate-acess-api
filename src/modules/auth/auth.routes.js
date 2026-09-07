const { Router } = require('express');
const controller = require('./auth.controller');
const {
  loginIpLimiter,
  loginEmailLimiter,
  refreshLimiter,
  forgotPasswordLimiter,
} = require('../../middlewares/rateLimit');

const router = Router();

// Dois limitadores em série no login: por IP (força bruta de origem única)
// e por e-mail (força bruta distribuída contra a mesma conta) — ver
// middlewares/rateLimit.js.
router.post('/login', loginIpLimiter, loginEmailLimiter, controller.login);
router.post('/refresh', refreshLimiter, controller.refresh);
router.post('/logout', controller.logout);
router.post('/forgot-password', forgotPasswordLimiter, controller.forgotPassword);
router.post('/reset-password', controller.resetPassword);

module.exports = router;
