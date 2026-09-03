const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const controller = require('./fleet-logs.controller');

const router = Router();

router.use(authenticate);

// /on-trip precisa vir ANTES de /:id, mesmo motivo do /active em access-logs.
router.get('/on-trip', controller.listOnTrip);
router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.getById);
router.patch('/:id/return', controller.returnTrip);

module.exports = router;
