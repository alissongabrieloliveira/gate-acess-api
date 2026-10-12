// Jest `setupFilesAfterEnv`: fecha, no fim de cada arquivo de teste, a pool da
// API (src/config/db.js, papel app_runtime). Os testes fecham só a própria
// conexão (tests/helpers/db.js, dono das tabelas) — sem isto o Jest não sai
// quando roda um arquivo sozinho.
afterAll(async () => {
  await require('../src/config/db').destroy();
});
