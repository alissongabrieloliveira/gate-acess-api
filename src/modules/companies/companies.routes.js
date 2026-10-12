const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const authorize = require('../../middlewares/authorize');
const RULES = require('../../config/rules');
const { uploadCompanyLogo } = require('../../middlewares/upload');
const controller = require('./companies.controller');

const router = Router();

router.get('/me', authenticate, controller.getMe);
// Só admin edita os dados da própria empresa — mesmo critério de
// gates/sectors (leitura aberta, escrita admin-only).
router.put('/me', authenticate, authorize(RULES.ADMIN), controller.updateMe);
// Logo (recibo e relatórios em PDF): multipart, campo "logo".
router.post('/me/logo', authenticate, authorize(RULES.ADMIN), uploadCompanyLogo.single('logo'), controller.uploadLogo);
router.delete('/me/logo', authenticate, authorize(RULES.ADMIN), controller.removeLogo);

module.exports = router;
