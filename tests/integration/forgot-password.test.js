// SMTP não está configurado em .env.test de propósito (ver env.js) — mocka
// o módulo de envio pra conseguir capturar o token bruto que só existe em
// memória durante a request (o banco só guarda o hash, igual refresh_tokens).
jest.mock('../../src/utils/email');

const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { sendPasswordResetEmail } = require('../../src/utils/email');
const { hashRefreshToken } = require('../../src/utils/refreshToken');
const { createCompany, createUser } = require('../helpers/factories');

function extractToken(resetUrl) {
  return new URL(resetUrl).searchParams.get('token');
}

describe('POST /api/v1/auth/forgot-password, /reset-password', () => {
  let company;
  let user;

  beforeEach(() => {
    sendPasswordResetEmail.mockClear();
  });

  beforeAll(async () => {
    company = await createCompany();
    user = await createUser({ companyId: company.id, password: 'SenhaAntiga123!' });
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('e-mail existente -> 200 genérico e cria um token no banco', async () => {
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });

    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(sendPasswordResetEmail.mock.calls[0][0].to).toBe(user.email);

    const rows = await db('password_reset_tokens').where({ user_id: user.id });
    expect(rows).toHaveLength(1);
  });

  test('e-mail inexistente -> MESMA resposta 200 genérica (anti-enumeração)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ninguem@nao-existe.com' });

    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test('reset com token válido troca a senha e permite logar com a nova', async () => {
    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
    const resetUrl = sendPasswordResetEmail.mock.calls[0][0].resetUrl;
    const token = extractToken(resetUrl);

    const resetRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'SenhaNovaDefinida456!' });
    expect(resetRes.status).toBe(200);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'SenhaNovaDefinida456!' });
    expect(loginRes.status).toBe(200);
  });

  test('token usado duas vezes -> segunda vez falha', async () => {
    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
    const resetUrl = sendPasswordResetEmail.mock.calls[0][0].resetUrl;
    const token = extractToken(resetUrl);

    const first = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'PrimeiraTroca123!' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'SegundaTroca456!' });
    expect(second.status).toBe(400);
  });

  test('token expirado -> falha', async () => {
    const { raw, hash } = { raw: 'raw-token-de-teste', hash: hashRefreshToken('raw-token-de-teste') };
    await db('password_reset_tokens').insert({
      company_id: company.id,
      user_id: user.id,
      token_hash: hash,
      expires_at: new Date(Date.now() - 60 * 1000), // 1 minuto no passado
    });

    const res = await request(app).post('/api/v1/auth/reset-password').send({ token: raw, password: 'QualquerSenha123!' });
    expect(res.status).toBe(400);
  });

  test('token inexistente -> falha', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'token-que-nunca-existiu', password: 'QualquerSenha123!' });
    expect(res.status).toBe(400);
  });

  test('reset revoga os refresh tokens ativos do usuário', async () => {
    const targetUser = await createUser({ companyId: company.id, password: 'SenhaOriginal123!' });

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: targetUser.email, password: 'SenhaOriginal123!' });
    const oldRefreshCookie = loginRes.headers['set-cookie']
      .find((cookie) => cookie.startsWith('refresh_token='))
      .split(';')[0];

    await request(app).post('/api/v1/auth/forgot-password').send({ email: targetUser.email });
    const resetUrl = sendPasswordResetEmail.mock.calls[0][0].resetUrl;
    const token = extractToken(resetUrl);
    await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'SenhaPosReset456!' });

    const refreshRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', oldRefreshCookie);
    expect(refreshRes.status).toBe(401);
  });

  test('forgotPasswordLimiter bloqueia depois de muitas tentativas pro mesmo e-mail', async () => {
    const targetUser = await createUser({ companyId: company.id });

    // forgotPasswordLimiter = 5 tentativas / 15min, contando TODAS (não só falhas).
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: targetUser.email });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).post('/api/v1/auth/forgot-password').send({ email: targetUser.email });
    expect(blocked.status).toBe(429);
  });
});
