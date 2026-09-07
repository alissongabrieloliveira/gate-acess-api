const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');

// Endpoint público (sem authenticate) — pronto pra um monitor de uptime
// externo apontar pra ele. O banco de teste está sempre disponível na
// suíte, então o caminho de falha de banco (503) não é exercitado aqui.
describe('GET /api/v1/health', () => {
  afterAll(async () => {
    await db.destroy();
  });

  test('sem token de autenticação -> 200 com status ok', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.nodeEnv).toBe('test');
  });

  test('resposta traz X-Request-Id pra correlacionar com os logs do servidor', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.headers['x-request-id']).toBeTruthy();
  });
});
