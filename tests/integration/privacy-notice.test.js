const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const db = require('../helpers/db');
const { createCompany, createUser } = require('../helpers/factories');
const { PRIVACY_NOTICE_VERSION } = require('../../src/config/privacyNotice');

afterAll(async () => {
  await db.destroy();
});

// LGPD: o operador precisa dar ciência do aviso de privacidade e do termo de
// responsabilidade (versão vigente) antes de usar o sistema.
describe('Aviso de privacidade dos operadores', () => {
  let company;
  let user;

  beforeAll(async () => {
    company = await createCompany();
    user = await createUser({ companyId: company.id, password: 'SenhaAviso123!' });
  });

  async function login() {
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'SenhaAviso123!' });
    expect(res.status).toBe(200);
    return { token: res.body.accessToken, claims: jwt.decode(res.body.accessToken) };
  }

  test('pendente até o usuário aceitar a versão vigente; depois, não', async () => {
    const first = await login();
    expect(first.claims.privacy_notice_pending).toBe(true);

    const stale = await request(app)
      .post('/api/v1/users/me/privacy-notice')
      .set('Authorization', `Bearer ${first.token}`)
      .send({ version: '2000-01-01' });
    expect(stale.status).toBe(409);

    const accepted = await request(app)
      .post('/api/v1/users/me/privacy-notice')
      .set('Authorization', `Bearer ${first.token}`)
      .send({ version: PRIVACY_NOTICE_VERSION });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ id: user.id, privacyNoticeVersion: PRIVACY_NOTICE_VERSION });
    expect(accepted.body.privacyNoticeAcceptedAt).toBeTruthy();

    const second = await login();
    expect(second.claims.privacy_notice_pending).toBe(false);

    const [audit] = await db('audit_logs')
      .where({ table_name: 'users', record_id: user.id, action: 'UPDATE' })
      .orderBy('id', 'desc');
    expect(audit.user_id).toBe(user.id);
    expect(audit.new_data.privacy_notice_version).toBe(PRIVACY_NOTICE_VERSION);
  });

  test('versão nova do aviso volta a deixar o usuário pendente', async () => {
    await db('users').where({ id: user.id }).update({ privacy_notice_version: '2000-01-01' });
    const { claims } = await login();
    expect(claims.privacy_notice_pending).toBe(true);
  });

  test('exige autenticação', async () => {
    const res = await request(app).post('/api/v1/users/me/privacy-notice').send({ version: PRIVACY_NOTICE_VERSION });
    expect(res.status).toBe(401);
  });
});
