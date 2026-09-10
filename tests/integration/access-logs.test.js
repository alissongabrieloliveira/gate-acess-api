const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { signAccessToken } = require('../../src/utils/jwt');
const {
  createCompany,
  createAdminUser,
  createPerson,
  createVehicle,
  createGate,
  createSector,
} = require('../helpers/factories');

describe('Controle de Acessos (access-logs) — entrada, saída e regras de negócio', () => {
  let company;
  let admin;
  let token;
  let gate;
  let otherCompanyPerson;

  beforeAll(async () => {
    company = await createCompany();
    admin = await createAdminUser(company.id);
    token = signAccessToken({ userId: admin.id, companyId: company.id, rules: admin.rules, mustChangePassword: false });
    gate = await createGate({ companyId: company.id });

    const otherCompany = await createCompany();
    otherCompanyPerson = await createPerson({ companyId: otherCompany.id });
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('POST /access-logs sem personId/entryGateId -> 400', async () => {
    const res = await request(app).post('/api/v1/access-logs').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  test('POST /access-logs referenciando pessoa de OUTRA empresa -> 400 (assertBelongsToCompany)', async () => {
    const res = await request(app)
      .post('/api/v1/access-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ personId: otherCompanyPerson.id, entryGateId: gate.id });
    expect(res.status).toBe(400);
  });

  test('POST /access-logs com pessoa bloqueada -> 403 com o motivo do bloqueio na mensagem', async () => {
    const blocked = await createPerson({ companyId: company.id, isBlocked: true, blockReason: 'Suspeita de furto' });
    const res = await request(app)
      .post('/api/v1/access-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ personId: blocked.id, entryGateId: gate.id });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Suspeita de furto/);
  });

  test('POST /access-logs referenciando setor de destino de OUTRA empresa -> 400', async () => {
    const person = await createPerson({ companyId: company.id });
    const otherCompany = await createCompany();
    const otherSector = await createSector({ companyId: otherCompany.id });
    const res = await request(app)
      .post('/api/v1/access-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ personId: person.id, entryGateId: gate.id, destinationSectorId: otherSector.id });
    expect(res.status).toBe(400);
  });

  test('POST /access-logs com veículo bloqueado -> 403', async () => {
    const person = await createPerson({ companyId: company.id });
    const vehicle = await createVehicle({ companyId: company.id });
    await db('vehicles').where({ id: vehicle.id }).update({ is_blocked: true, block_reason: 'Documentação vencida' });

    const res = await request(app)
      .post('/api/v1/access-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ personId: person.id, vehicleId: vehicle.id, entryGateId: gate.id });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Documentação vencida/);
  });

  test('POST /access-logs registra a entrada e ignora entryOperatorId enviado pelo cliente (nunca confia no body)', async () => {
    const person = await createPerson({ companyId: company.id });
    const otherAdmin = await createAdminUser(company.id);

    const res = await request(app)
      .post('/api/v1/access-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ personId: person.id, entryGateId: gate.id, entryOperatorId: otherAdmin.id, kmEntry: 100 });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.entryOperatorId).toBe(admin.id);
    expect(res.body.entryOperatorId).not.toBe(otherAdmin.id);
  });

  test('POST /access-logs com kmEntry negativo -> 400 (CHECK do banco mapeado)', async () => {
    const person = await createPerson({ companyId: company.id });
    const res = await request(app)
      .post('/api/v1/access-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ personId: person.id, entryGateId: gate.id, kmEntry: -10 });
    expect(res.status).toBe(400);
  });

  test('código de recibo duplicado na mesma empresa -> 409', async () => {
    const receiptCode = `RCPT-${Date.now()}`;
    const personA = await createPerson({ companyId: company.id });
    const personB = await createPerson({ companyId: company.id });

    const first = await request(app)
      .post('/api/v1/access-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ personId: personA.id, entryGateId: gate.id, receiptCode });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/access-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ personId: personB.id, entryGateId: gate.id, receiptCode });
    expect(second.status).toBe(409);
  });

  test('GET /access-logs/active só lista acessos com status ACTIVE', async () => {
    const person = await createPerson({ companyId: company.id });
    const created = await request(app)
      .post('/api/v1/access-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ personId: person.id, entryGateId: gate.id });

    const res = await request(app).get('/api/v1/access-logs/active').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((l) => l.id)).toContain(created.body.id);
    expect(res.body.data.every((l) => l.status === 'ACTIVE')).toBe(true);
  });

  describe('PATCH /:id/exit', () => {
    async function registerEntry(overrides = {}) {
      const person = await createPerson({ companyId: company.id });
      const res = await request(app)
        .post('/api/v1/access-logs')
        .set('Authorization', `Bearer ${token}`)
        .send({ personId: person.id, entryGateId: gate.id, kmEntry: 1000, ...overrides });
      return res.body;
    }

    test('sem exitGateId -> 400', async () => {
      const log = await registerEntry();
      const res = await request(app).patch(`/api/v1/access-logs/${log.id}/exit`).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(400);
    });

    test('finaliza o acesso com sucesso (status vira FINISHED)', async () => {
      const log = await registerEntry();
      const res = await request(app)
        .patch(`/api/v1/access-logs/${log.id}/exit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ exitGateId: gate.id, kmExit: 1050, observation: 'Saída normal' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('FINISHED');
      expect(res.body.kmExit).toBe(1050);
      expect(res.body.observation).toBe('Saída normal');
    });

    test('kmExit menor que kmEntry -> 400 (CHECK chk_km_logic mapeado)', async () => {
      const log = await registerEntry({ kmEntry: 1000 });
      const res = await request(app)
        .patch(`/api/v1/access-logs/${log.id}/exit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ exitGateId: gate.id, kmExit: 500 });
      expect(res.status).toBe(400);
    });

    test('finalizar duas vezes -> 409 na segunda', async () => {
      const log = await registerEntry();
      const first = await request(app)
        .patch(`/api/v1/access-logs/${log.id}/exit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ exitGateId: gate.id });
      expect(first.status).toBe(200);

      const second = await request(app)
        .patch(`/api/v1/access-logs/${log.id}/exit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ exitGateId: gate.id });
      expect(second.status).toBe(409);
    });

    test('exitGateId de outra empresa -> 400', async () => {
      const otherCompany = await createCompany();
      const otherGate = await createGate({ companyId: otherCompany.id });
      const log = await registerEntry();
      const res = await request(app)
        .patch(`/api/v1/access-logs/${log.id}/exit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ exitGateId: otherGate.id });
      expect(res.status).toBe(400);
    });
  });

  test('GET /access-logs?search= encontra pelo nome da pessoa mesmo fora da página atual', async () => {
    const person = await createPerson({ companyId: company.id, name: 'Zebedeu Buscavel Unico' });
    await request(app)
      .post('/api/v1/access-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ personId: person.id, entryGateId: gate.id });

    const res = await request(app)
      .get('/api/v1/access-logs')
      .query({ search: 'Zebedeu Buscavel' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((l) => l.personId === person.id)).toBe(true);
  });

  test('GET /access-logs?search= sem nenhuma pessoa/veículo correspondente retorna vazio', async () => {
    const res = await request(app)
      .get('/api/v1/access-logs')
      .query({ search: 'zzz-termo-sem-correspondencia-zzz' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  test('registro de outra empresa não é visível (isolamento de tenant)', async () => {
    const otherCompany = await createCompany();
    const otherAdmin = await createAdminUser(otherCompany.id);
    const otherGate = await createGate({ companyId: otherCompany.id });
    const otherPerson = await createPerson({ companyId: otherCompany.id });
    const otherToken = signAccessToken({
      userId: otherAdmin.id,
      companyId: otherCompany.id,
      rules: otherAdmin.rules,
      mustChangePassword: false,
    });
    const created = await request(app)
      .post('/api/v1/access-logs')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ personId: otherPerson.id, entryGateId: otherGate.id });

    const res = await request(app).get(`/api/v1/access-logs/${created.body.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
