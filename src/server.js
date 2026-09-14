const http = require('http');
const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const { attachGatewayWs } = require('./gatewayWs/gatewayWs');

// http.createServer explícito (em vez de app.listen) porque o WebSocket
// server do gateway precisa se anexar ao mesmo servidor HTTP, na mesma
// porta (upgrade de conexão em /ws/gateway) — ver gatewayWs.js.
const server = http.createServer(app);
attachGatewayWs(server);

server.listen(env.port, () => {
  logger.info(`API rodando na porta ${env.port} (${env.nodeEnv})`);
});
