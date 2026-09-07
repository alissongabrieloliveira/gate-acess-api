const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');

app.listen(env.port, () => {
  logger.info(`API rodando na porta ${env.port} (${env.nodeEnv})`);
});
