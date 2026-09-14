const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const controller = require('./gate-directions.controller');

const router = Router();

router.use(authenticate);

// Sem authorize(...): qualquer operador autenticado pode abrir/fechar as
// cancelas de entrada/saída (decisão explícita — faz parte do fluxo normal
// de registrar entrada/saída). A tela de diagnóstico/teste (/gate-control
// no frontend) é que fica restrita a admin, só na camada de UI.
router.get('/', controller.list);
router.post('/:direction/open', controller.open);
router.post('/:direction/close', controller.close);

module.exports = router;
