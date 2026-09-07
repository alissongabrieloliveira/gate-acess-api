const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { createCompany, createUser } = require('../helpers/factories');
const { extractCookiePair } = require('../helpers/auth');

describe('POST /api/v1/auth/login, /refresh, /logout', () => {
  let company;
  let user;

  beforeAll(async () => {
    company = await createCompany();
    user = await createUser({ companyId: company.id, password: 'SenhaCorreta123!' });
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('login com credenciais corretas retorna access token e cookie de refresh', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'SenhaCorreta123!' });

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(extractCookiePair(res.headers['set-cookie'], 'refresh_token')).not.toBeNull();
  });

  test('senha errada -> 401 com mensagem genérica', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'senha-errada' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Credenciais inválidas');
  });

  test('e-mail inexistente -> 401 com a MESMA mensagem genérica (não vaza se a conta existe)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ninguem@nao-existe.com', password: 'qualquer' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Credenciais inválidas');
  });

  test('POST /auth/refresh com cookie válido rotaciona pro um novo refresh token', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'SenhaCorreta123!' });
    const refreshCookie = extractCookiePair(login.headers['set-cookie'], 'refresh_token');

    const refreshRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie);

    expect(refreshRes.status).toBe(200);
    expect(typeof refreshRes.body.accessToken).toBe('string');
    // O access token pode sair byte-idêntico ao anterior se as duas chamadas
    // caírem no mesmo segundo (HS256 é determinístico pra claims+iat iguais)
    // — o que realmente rotaciona, e é o que importa testar aqui, é o
    // refresh token em si (alta entropia, nunca repete).
    const newRefreshCookie = extractCookiePair(refreshRes.headers['set-cookie'], 'refresh_token');
    expect(newRefreshCookie).not.toBeNull();
    expect(newRefreshCookie).not.toBe(refreshCookie);
  });

  test('refresh token já usado (rotacionado) é rejeitado ao ser reaproveitado', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'SenhaCorreta123!' });
    const originalCookie = extractCookiePair(login.headers['set-cookie'], 'refresh_token');

    // Primeira troca: rotaciona e revoga o token original.
    await request(app).post('/api/v1/auth/refresh').set('Cookie', originalCookie);

    // Reusar o token original (já revogado) deve ser rejeitado.
    const reuse = await request(app).post('/api/v1/auth/refresh').set('Cookie', originalCookie);
    expect(reuse.status).toBe(401);
  });

  test('POST /auth/logout revoga o refresh token', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'SenhaCorreta123!' });
    const refreshCookie = extractCookiePair(login.headers['set-cookie'], 'refresh_token');

    const logoutRes = await request(app).post('/api/v1/auth/logout').set('Cookie', refreshCookie);
    expect(logoutRes.status).toBe(204);

    const refreshAfterLogout = await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie);
    expect(refreshAfterLogout.status).toBe(401);
  });

  test('loginEmailLimiter bloqueia após muitas tentativas falhas pro mesmo e-mail', async () => {
    const targetUser = await createUser({ companyId: company.id, password: 'OutraSenha123!' });

    // loginEmailLimiter = 8 tentativas falhas / 15min (skipSuccessfulRequests).
    for (let i = 0; i < 8; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: targetUser.email, password: 'senha-errada' });
      expect(res.status).toBe(401);
    }

    const blocked = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: targetUser.email, password: 'senha-errada' });
    expect(blocked.status).toBe(429);
  });
});
