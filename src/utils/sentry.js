const Sentry = require('@sentry/node');
const env = require('../config/env');
const logger = require('./logger');

// Opcional (ver config/env.js#sentryDsn) — sem DSN, simplesmente não
// inicializa, sem lançar erro nenhum (mesmo critério do SMTP: rastreamento
// de erro é uma camada a mais, não uma dependência dura da API).
// Sem `tracesSampleRate`/performance tracing de propósito — este item
// cobre rastreamento de erro, não monitoramento de performance.
function initSentry() {
  if (!env.sentryDsn) {
    logger.debug('SENTRY_DSN não configurado — rastreamento de erros desativado');
    return;
  }

  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.nodeEnv,
  });
}

module.exports = { initSentry, Sentry };
