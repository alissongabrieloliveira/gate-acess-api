const { randomUUID } = require('crypto');
const pinoHttp = require('pino-http');
const logger = require('../utils/logger');

// Um id por requisição: permite cruzar um erro relatado por um operador
// (comparando o id do header X-Request-Id da resposta) com a linha de log
// correspondente no servidor, mesmo sem um agregador de log de verdade
// ainda. `authenticate` roda depois deste middleware, então
// `req.auth` só existe pra rotas autenticadas — as públicas (login,
// health) logam sem esses campos.
const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customProps: (req) => ({
    userId: req.auth?.userId,
    companyId: req.auth?.companyId,
  }),
});

module.exports = requestLogger;
