const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { signAccessToken } = require('../../src/utils/jwt');
const RULES = require('../../src/config/rules');
const { createCompany, createAdminUser, createRegularUser } = require('../helpers/factories');

function tokenFor(user, companyId) {
  return signAccessToken({ userId: user.id, companyId, rules: user.rules, mustChangePassword: false });
}

describe('RBAC — rotas admin-only (/users) e "admin ou o próprio usuário"', () => {
  let company;
  let admin;
  let operator;
  let otherOperator;
  let adminToken;
  let operatorToken;

  beforeAll(async () => {
    company = await createCompany();
    admin = await createAdminUser(company.id);
    operator = await createRegularUser(company.id);
    otherOperator = await createRegularUser(company.id);
    adminToken = tokenFor(admin, company.id);
    operatorToken = tokenFor(operator, company.id);
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('GET /users sem token -> 401', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(401);
  });

  test('GET /users como operador não-admin -> 403', async () => {
    const res = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Permissão insuficiente');
  });

  test('GET /users como admin -> 200', async () => {
    const res = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('PATCH /users/:id no próprio usuário (operador comum) -> 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${operator.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'Nome Atualizado Por Mim Mesmo' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Nome Atualizado Por Mim Mesmo');
  });

  test('PATCH /users/:id em OUTRO usuário (operador comum) -> 403', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${otherOperator.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'Tentando Editar Outro' });
    expect(res.status).toBe(403);
  });

  test('operador comum não pode alterar as próprias `rules` (só admin)', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${operator.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ rules: RULES.ADMIN });
    expect(res.status).toBe(403);
  });

  test('admin PODE alterar `rules`/`isActive` de outro usuário', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${otherOperator.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });
});
