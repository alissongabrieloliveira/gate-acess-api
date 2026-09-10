// Mesma estrutura de tests/integration/gates.test.js — sectors é
// implementado como módulo próprio (não um CRUD genérico compartilhado),
// mesmo critério documentado quando os dois módulos foram criados, então os
// testes também seguem separados em vez de parametrizar um caso só.
const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { signAccessToken } = require('../../src/utils/jwt');
const { createCompany, createAdminUser, createRegularUser, createSector } = require('../helpers/factories');

function tokenFor(user, companyId) {
  return signAccessToken({ userId: user.id, companyId, rules: user.rules, mustChangePassword: false });
}

describe('Setores (sectors) — leitura aberta, escrita admin-only, nome único', () => {
  let company;
  let adminToken;
  let operatorToken;

  beforeAll(async () => {
    company = await createCompany();
    const admin = await createAdminUser(company.id);
    const operator = await createRegularUser(company.id);
    adminToken = tokenFor(admin, company.id);
    operatorToken = tokenFor(operator, company.id);
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('GET /sectors é acessível a qualquer operador autenticado', async () => {
    await createSector({ companyId: company.id, name: 'Diretoria' });
    const res = await request(app).get('/api/v1/sectors').set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test('POST /sectors como operador não-admin -> 403', async () => {
    const res = await request(app)
      .post('/api/v1/sectors')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'Setor Tentativa Operador' });
    expect(res.status).toBe(403);
  });

  test('POST /sectors sem nome -> 400', async () => {
    const res = await request(app).post('/api/v1/sectors').set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(400);
  });

  test('POST /sectors como admin -> 201, nasce ativo por padrão', async () => {
    const res = await request(app)
      .post('/api/v1/sectors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Setor Novo ${Date.now()}` });
    expect(res.status).toBe(201);
    expect(res.body.isActive).toBe(true);
  });

  test('nome de setor duplicado na mesma empresa -> 409', async () => {
    const name = `Setor Duplicado ${Date.now()}`;
    await createSector({ companyId: company.id, name });
    const res = await request(app).post('/api/v1/sectors').set('Authorization', `Bearer ${adminToken}`).send({ name });
    expect(res.status).toBe(409);
  });

  test('reaproveitar o nome de um setor soft-deletado não conflita (índice único é parcial)', async () => {
    const name = `Setor Reaproveitavel ${Date.now()}`;
    const sector = await createSector({ companyId: company.id, name });
    await db('sectors').where({ id: sector.id }).update({ deleted_at: new Date() });

    const res = await request(app).post('/api/v1/sectors').set('Authorization', `Bearer ${adminToken}`).send({ name });
    expect(res.status).toBe(201);
  });

  test('PUT /sectors/:id como operador não-admin -> 403', async () => {
    const sector = await createSector({ companyId: company.id });
    const res = await request(app)
      .put(`/api/v1/sectors/${sector.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ description: 'Tentativa indevida' });
    expect(res.status).toBe(403);
  });

  test('PUT /sectors/:id como admin atualiza e desativa', async () => {
    const sector = await createSector({ companyId: company.id });
    const res = await request(app)
      .put(`/api/v1/sectors/${sector.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'Descrição nova', isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Descrição nova');
    expect(res.body.isActive).toBe(false);
  });

  test('PUT /sectors/:id sem nenhum campo -> 400', async () => {
    const sector = await createSector({ companyId: company.id });
    const res = await request(app).put(`/api/v1/sectors/${sector.id}`).set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(400);
  });

  test('PUT /sectors/:id inexistente -> 404', async () => {
    const res = await request(app)
      .put('/api/v1/sectors/999999')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'x' });
    expect(res.status).toBe(404);
  });

  test('GET /sectors?search= encontra por trecho da descrição', async () => {
    const sector = await createSector({ companyId: company.id, name: `Setor Busca ${Date.now()}`, description: 'sala de espera dos visitantes' });
    const res = await request(app)
      .get('/api/v1/sectors')
      .query({ search: 'espera' })
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((s) => s.id)).toContain(sector.id);
  });

  test('GET /sectors?isActive=false filtra só os inativos', async () => {
    const inactive = await createSector({ companyId: company.id, isActive: false });
    const res = await request(app)
      .get('/api/v1/sectors')
      .query({ isActive: 'false' })
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((s) => s.id)).toContain(inactive.id);
    expect(res.body.data.every((s) => s.isActive === false)).toBe(true);
  });
});
