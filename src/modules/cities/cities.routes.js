const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const controller = require('./cities.controller');

const router = Router();

// Sem authorize(ADMIN): cidade é referência global, só leitura, qualquer
// operador autenticado pode consultar (usado no campo Destino do Controle
// de Frota).
router.use(authenticate);

router.get('/', controller.list);

module.exports = router;
