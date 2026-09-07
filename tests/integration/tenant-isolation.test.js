// Prioridade máxima desta suíte: o isolamento entre empresas é garantido
// INTEIRAMENTE pelo filtro `WHERE company_id = ?` em cada repository — o RLS
// do Postgres existe no schema mas não é aplicado de verdade, porque a app
// conecta como dono das tabelas (ver claude.md seção 2/5.5 e memoria.md). Se
// um repository esquecer esse filtro, nada no banco pega isso — só um teste
// como este.
const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { signAccessToken } = require('../../src/utils/jwt');
const { createCompany, createAdminUser, createPerson, createVehicle } = require('../helpers/factories');

describe('Isolamento entre empresas (tenant isolation)', () => {
  let companyA;
  let companyB;
  let adminA;
  let personA;
  let personB;
  let vehicleA;
  let vehicleB;
  let tokenA;

  beforeAll(async () => {
    companyA = await createCompany();
    companyB = await createCompany();
    adminA = await createAdminUser(companyA.id);
    await createAdminUser(companyB.id);

    personA = await createPerson({ companyId: companyA.id, name: 'Pessoa da Empresa A' });
    personB = await createPerson({ companyId: companyB.id, name: 'Pessoa da Empresa B' });
    vehicleA = await createVehicle({ companyId: companyA.id });
    vehicleB = await createVehicle({ companyId: companyB.id });

    tokenA = signAccessToken({
      userId: adminA.id,
      companyId: companyA.id,
      rules: adminA.rules,
      mustChangePassword: false,
    });
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('people', () => {
    test('GET /people só lista os registros da própria empresa', async () => {
      const res = await request(app).get('/api/v1/people').set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      const ids = res.body.data.map((p) => p.id);
      expect(ids).toContain(personA.id);
      expect(ids).not.toContain(personB.id);
    });

    test('GET /people/:id de um registro de outra empresa não vaza o dado', async () => {
      const res = await request(app).get(`/api/v1/people/${personB.id}`).set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty('name');
    });

    test('PUT /people/:id de um registro de outra empresa não altera nada', async () => {
      const res = await request(app)
        .put(`/api/v1/people/${personB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Nome Invadido' });
      expect([400, 404]).toContain(res.status);
    });
  });

  describe('vehicles', () => {
    test('GET /vehicles só lista os veículos da própria empresa', async () => {
      const res = await request(app).get('/api/v1/vehicles').set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      const ids = res.body.data.map((v) => v.id);
      expect(ids).toContain(vehicleA.id);
      expect(ids).not.toContain(vehicleB.id);
    });

    test('GET /vehicles/:id de um veículo de outra empresa não vaza o dado', async () => {
      const res = await request(app).get(`/api/v1/vehicles/${vehicleB.id}`).set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty('licensePlate');
    });
  });

  describe('users', () => {
    test('GET /users só lista os usuários da própria empresa', async () => {
      const res = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      const ids = res.body.data.map((u) => u.id);
      const companyBUserIds = await db('users').where({ company_id: companyB.id }).pluck('id');
      companyBUserIds.forEach((id) => expect(ids).not.toContain(id));
    });
  });
});
