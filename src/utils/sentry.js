const Sentry = require('@sentry/node');
const env = require('../config/env');
const logger = require('./logger');
const { redactUrl } = require('./redactUrl');

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
    // Mesmo filtro do log: a URL da requisição e das chamadas de saída
    // (breadcrumbs) podem levar CPF/nome/placa ou token na query string.
    beforeSend(event) {
      if (event.request) {
        event.request.url = redactUrl(event.request.url);
        delete event.request.query_string;
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data?.url) {
        breadcrumb.data.url = redactUrl(breadcrumb.data.url);
      }
      return breadcrumb;
    },
  });
}

module.exports = { initSentry, Sentry };
