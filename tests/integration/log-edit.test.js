const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { signAccessToken } = require('../../src/utils/jwt');
const {
  createCompany,
  createAdminUser,
  createRegularUser,
  createPerson,
  createVehicle,
  createGate,
  createSector,
} = require('../helpers/factories');

const PERSON_TYPE_EMPLOYEE = 3;
const VEHICLE_TYPE_FLEET = 2;

describe('Edição de registros (PUT /access-logs/:id e PUT /fleet-logs/:id) — só admin', () => {
  let company;
  let adminToken;
  let operatorToken;
  let gate;
  let otherCompanySector;

  beforeAll(async () => {
    company = await createCompany();
    const admin = await createAdminUser(company.id);
    const operator = await createRegularUser(company.id);
    adminToken = signAccessToken({ userId: admin.id, companyId: company.id, rules: admin.rules, mustChangePassword: false });
    operatorToken = signAccessToken({ userId: operator.id, companyId: company.id, rules: 0, mustChangePassword: false });
    gate = await createGate({ companyId: company.id });
    const otherCompany = await createCompany();
    otherCompanySector = await createSector({ companyId: otherCompany.id });
  });

  afterAll(async () => {
    await db.destroy();
  });

  const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();

  describe('Controle de Acessos', () => {
    // Funcionário com veículo: KM obrigatório (regra mais restritiva).
    async function createAccess({ finished = true, kmEntry = 1000, kmExit = 1002 } = {}) {
      const person = await createPerson({ companyId: company.id, personType: PERSON_TYPE_EMPLOYEE });
      const vehicle = await createVehicle({ companyId: company.id });
      const entry = await request(app)
        .post('/api/v1/access-logs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ personId: person.id, vehicleId: vehicle.id, entryGateId: gate.id, kmEntry });
      if (!finished) return entry.body;
      const exit = await request(app)
        .patch(`/api/v1/access-logs/${entry.body.id}/exit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ exitGateId: gate.id, kmExit });
      return exit.body;
    }

    const put = (id, body, token = adminToken) =>
      request(app).put(`/api/v1/access-logs/${id}`).set('Authorization', `Bearer ${token}`).send(body);

    test('operador (não admin) -> 403', async () => {
      const log = await createAccess();
      const res = await put(log.id, { kmEntry: 1001 }, operatorToken);
      expect(res.status).toBe(403);
    });

    test('corrige KM, setor, anfitrião e datas e grava na Auditoria', async () => {
      const log = await createAccess();
      const sector = await createSector({ companyId: company.id });
      const host = await createPerson({ companyId: company.id, personType: PERSON_TYPE_EMPLOYEE });
      const entryTime = minutesAgo(120);
      const exitTime = minutesAgo(60);

      const res = await put(log.id, {
        kmEntry: 2000,
        kmExit: 2003,
        destinationSectorId: sector.id,
        visitedPersonId: host.id,
        entryTime,
        exitTime,
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        kmEntry: 2000,
        kmExit: 2003,
        destinationSectorId: sector.id,
        visitedPersonId: host.id,
      });
      expect(new Date(res.body.entryTime).toISOString()).toBe(entryTime);
      expect(new Date(res.body.exitTime).toISOString()).toBe(exitTime);

      const audit = await db('audit_logs')
        .where({ table_name: 'access_logs', record_id: log.id, action: 'UPDATE' })
        .orderBy('id', 'desc')
        .first();
      expect(audit).toBeTruthy();
      expect(audit.new_data.km_entry).toBe(2000);
    });

    test('limpa setor e anfitrião com null', async () => {
      const log = await createAccess();
      const sector = await createSector({ companyId: company.id });
      await put(log.id, { destinationSectorId: sector.id });

      const res = await put(log.id, { destinationSectorId: null, visitedPersonId: null });
      expect(res.status).toBe(200);
      expect(res.body.destinationSectorId).toBeNull();
      expect(res.body.visitedPersonId).toBeNull();
    });

    test('KM de saída menor que o de entrada -> 400', async () => {
      const log = await createAccess();
      const res = await put(log.id, { kmExit: 999 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/não pode ser menor/);
    });

    test('apagar KM obrigatório -> 400; com "KM indisponível" -> 200', async () => {
      const log = await createAccess();
      expect((await put(log.id, { kmEntry: null })).status).toBe(400);

      const res = await put(log.id, { kmEntry: null, isKmUnavailable: true });
      expect(res.status).toBe(200);
      expect(res.body.kmEntry).toBeNull();
      expect(res.body.kmExit).toBe(1002);
      expect(res.body.isKmUnavailable).toBe(true);
    });

    test('saída antes da entrada -> 400', async () => {
      const log = await createAccess();
      const res = await put(log.id, { entryTime: minutesAgo(30), exitTime: minutesAgo(60) });
      expect(res.status).toBe(400);
    });

    test('data no futuro -> 400; data inválida -> 400', async () => {
      const log = await createAccess();
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      expect((await put(log.id, { entryTime: future })).status).toBe(400);
      expect((await put(log.id, { entryTime: 'ontem' })).status).toBe(400);
    });

    test('acesso em aberto: não aceita KM/data de saída, mas aceita o resto', async () => {
      const log = await createAccess({ finished: false });
      expect((await put(log.id, { kmExit: 1005 })).status).toBe(400);
      expect((await put(log.id, { exitTime: minutesAgo(1) })).status).toBe(400);

      const res = await put(log.id, { kmEntry: 1001 });
      expect(res.status).toBe(200);
      expect(res.body.kmEntry).toBe(1001);
      expect(res.body.status).toBe('ACTIVE');
    });

    test('setor de OUTRA empresa -> 400', async () => {
      const log = await createAccess();
      const res = await put(log.id, { destinationSectorId: otherCompanySector.id });
      expect(res.status).toBe(400);
    });

    test('registro inexistente -> 404', async () => {
      const res = await put(999999, { kmEntry: 1 });
      expect(res.status).toBe(404);
    });

    test('registro antigo sem KM: corrigir só o setor não exige KM', async () => {
      const log = await createAccess();
      await db('access_logs').where({ id: log.id }).update({ km_entry: null, km_exit: null });
      const sector = await createSector({ companyId: company.id });

      const res = await put(log.id, { destinationSectorId: sector.id });
      expect(res.status).toBe(200);
      expect(res.body.destinationSectorId).toBe(sector.id);
    });
  });

  describe('Controle de Frota', () => {
    async function createTrip({ returned = true } = {}) {
      const vehicle = await createVehicle({ companyId: company.id, vehicleType: VEHICLE_TYPE_FLEET });
      const dep = await request(app)
        .post('/api/v1/fleet-logs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ vehicleId: vehicle.id, departureGateId: gate.id, kmDeparture: 5000, destination: 'Goiânia' });
      if (!returned) return dep.body;
      const ret = await request(app)
        .patch(`/api/v1/fleet-logs/${dep.body.id}/return`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ returnGateId: gate.id, kmReturn: 5100 });
      return ret.body;
    }

    const put = (id, body, token = adminToken) =>
      request(app).put(`/api/v1/fleet-logs/${id}`).set('Authorization', `Bearer ${token}`).send(body);

    test('operador (não admin) -> 403', async () => {
      const log = await createTrip();
      expect((await put(log.id, { kmDeparture: 5001 }, operatorToken)).status).toBe(403);
    });

    test('corrige KM, destino, motivo e datas', async () => {
      const log = await createTrip();
      const departureTime = minutesAgo(300);
      const returnTime = minutesAgo(100);

      const res = await put(log.id, {
        kmDeparture: 6000,
        kmReturn: 6150,
        destination: '  Anápolis ',
        purpose: 'Entrega',
        departureTime,
        returnTime,
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ kmDeparture: 6000, kmReturn: 6150, destination: 'Anápolis', purpose: 'Entrega' });
      expect(new Date(res.body.departureTime).toISOString()).toBe(departureTime);
      expect(new Date(res.body.returnTime).toISOString()).toBe(returnTime);
    });

    test('retorno igual à saída -> 400 (tem que ser estritamente maior)', async () => {
      const log = await createTrip();
      const res = await put(log.id, { kmReturn: 5000 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/deve ser maior/);
    });

    test('KM é sempre obrigatório na frota, salvo "KM indisponível"', async () => {
      const log = await createTrip();
      expect((await put(log.id, { kmDeparture: null })).status).toBe(400);
      const res = await put(log.id, { kmDeparture: null, isKmUnavailable: true });
      expect(res.status).toBe(200);
      expect(res.body.kmDeparture).toBeNull();
    });

    test('viagem em andamento: não aceita KM/data de retorno', async () => {
      const log = await createTrip({ returned: false });
      expect((await put(log.id, { kmReturn: 5200 })).status).toBe(400);
      expect((await put(log.id, { returnTime: minutesAgo(1) })).status).toBe(400);
      expect((await put(log.id, { destination: 'Brasília' })).status).toBe(200);
    });

    test('retorno antes da saída -> 400', async () => {
      const log = await createTrip();
      const res = await put(log.id, { departureTime: minutesAgo(10), returnTime: minutesAgo(20) });
      expect(res.status).toBe(400);
    });

    test('destino com mais de 255 caracteres -> 400', async () => {
      const log = await createTrip();
      expect((await put(log.id, { destination: 'x'.repeat(256) })).status).toBe(400);
    });
  });
});
