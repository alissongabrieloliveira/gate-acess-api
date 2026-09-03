const app = require('./app');
const env = require('./config/env');

app.listen(env.port, () => {
  console.log(`API rodando na porta ${env.port} (${env.nodeEnv})`);
});
