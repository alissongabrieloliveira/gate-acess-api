const pino = require('pino');
const env = require('../config/env');

// De propósito, nunca logamos corpo de requisição/resposta em lugar
// nenhum (nem aqui, nem no requestLogger.js) — evitaria vazar senha, CPF,
// e-mail ou qualquer outro campo sensível pro log, mesmo princípio de LGPD
// já aplicado no resto do projeto (campos `*_encrypted`, blind index).
// O que redigimos aqui é o que o pino-http loga por padrão de qualquer
// jeito (headers da requisição/resposta) e que também pode vazar sessão.
const logger = pino({
  level: env.logLevel,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    censor: '[redacted]',
  },
  // pino-pretty só em desenvolvimento — produção e test saem como JSON
  // puro (uma linha por evento), pronto pra um agregador de log futuro.
  transport: env.nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
});

module.exports = logger;
