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
} = require('../helpers/factories');

const PERSON_TYPE_EMPLOYEE = 3;
const VEHICLE_TYPE_FLEET = 2;

afterAll(async () => {
  await db.destroy();
});

// LGPD art. 18/19: tudo o que o sistema guarda sobre uma pessoa, num só lugar.
describe('GET /people/:id/data-export', () => {
  let company;
  let otherCompany;
  let admin;
  let adminToken;
  let operatorToken;
  let gate;
  let person;

  beforeAll(async () => {
    company = await createCompany();
    otherCompany = await createCompany();
    admin = await createAdminUser(company.id);
    const operator = await createRegularUser(company.id);
    adminToken = signAccessToken({ userId: admin.id, companyId: company.id, rules: admin.rules, mustChangePassword: false });
    operatorToken = signAccessToken({ userId: operator.id, companyId: company.id, rules: operator.rules, mustChangePassword: false });
    gate = await createGate({ companyId: company.id, name: 'Portaria Norte' });
    person = await createPerson({ companyId: company.id, name: 'Titular Exportado', personType: PERSON_TYPE_EMPLOYEE });

    const auth = (req) => req.set('Authorization', `Bearer ${adminToken}`);
    await auth(request(app).put(`/api/v1/people/${person.id}`)).send({ phone: '62999990000' });

    const visitor = await createPerson({ companyId: company.id, name: 'Visitante do Titular' });
    const asVisitor = await auth(request(app).post('/api/v1/access-logs')).send({
      personId: person.id,
      entryGateId: gate.id,
      visitReason: 'Reunião',
    });
    expect(asVisitor.status).toBe(201);
    const asHost = await auth(request(app).post('/api/v1/access-logs')).send({
      personId: visitor.id,
      visitedPersonId: person.id,
      entryGateId: gate.id,
    });
    expect(asHost.status).toBe(201);
    const fleetVehicle = await createVehicle({ companyId: company.id, vehicleType: VEHICLE_TYPE_FLEET });
    const asDriver = await auth(request(app).post('/api/v1/fleet-logs')).send({
      vehicleId: fleetVehicle.id,
      driverId: person.id,
      departureGateId: gate.id,
      kmDeparture: 100,
      purpose: 'Banco',
    });
    expect(asDriver.status).toBe(201);
  });

  const exportAs = (token, id = person.id) =>
    request(app).get(`/api/v1/people/${id}/data-export`).set('Authorization', `Bearer ${token}`);

  test('reúne cadastro, acessos (visitante e anfitrião), frota e histórico', async () => {
    const res = await exportAs(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.person).toMatchObject({ id: person.id, name: 'Titular Exportado', cpf: person.cpf, phone: '62999990000' });
    expect(res.body.company.name).toBeTruthy();
    expect(res.body.accessLogsAsVisitor).toHaveLength(1);
    expect(res.body.accessLogsAsVisitor[0]).toMatchObject({ visitReason: 'Reunião', entryGate: { name: 'Portaria Norte' } });
    expect(res.body.accessLogsAsVisitor[0]).not.toHaveProperty('entryOperatorId');
    expect(res.body.accessLogsAsVisitor[0]).not.toHaveProperty('photoUrl');
    expect(res.body.accessLogsAsVisitor[0].hasVehiclePhoto).toBe(false);
    expect(res.body.fleetLogsAsDriver[0]).not.toHaveProperty('departureOperatorId');
    expect(res.body.accessLogsAsHost).toHaveLength(1);
    expect(res.body.accessLogsAsHost[0].person.name).toBe('Visitante do Titular');
    expect(res.body.fleetLogsAsDriver).toHaveLength(1);
    expect(res.body.fleetLogsAsDriver[0].purpose).toBe('Banco');

    const history = res.body.changeHistory;
    expect(history[0].action).toBe('INSERT');
    const phoneChange = history.find((h) => h.action === 'UPDATE');
    expect(phoneChange.fields).toEqual(['phone']);
    // Histórico sem autor nem valores cifrados.
    expect(JSON.stringify(history)).not.toMatch(/user_?id|_encrypted/i);
  });

  test('a exportação fica registrada na Auditoria com quem gerou', async () => {
    const before = await db('audit_logs').where({ table_name: 'people', record_id: person.id, action: 'EXPORT' });
    await exportAs(adminToken);
    const after = await db('audit_logs').where({ table_name: 'people', record_id: person.id, action: 'EXPORT' });
    expect(after.length).toBe(before.length + 1);
    expect(after[after.length - 1]).toMatchObject({ user_id: admin.id, company_id: company.id });
  });

  test('só admin exporta', async () => {
    expect((await exportAs(operatorToken)).status).toBe(403);
  });

  test('pessoa de outra empresa não é exportada', async () => {
    const stranger = await createPerson({ companyId: otherCompany.id });
    expect((await exportAs(adminToken, stranger.id)).status).toBe(404);
  });
});

describe('PUT /companies/me — contato de privacidade', () => {
  test('grava e devolve privacy_contact', async () => {
    const company = await createCompany();
    const admin = await createAdminUser(company.id);
    const token = signAccessToken({ userId: admin.id, companyId: company.id, rules: admin.rules, mustChangePassword: false });
    const res = await request(app)
      .put('/api/v1/companies/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ privacyContact: '  privacidade@empresa.com  ' });
    expect(res.status).toBe(200);
    expect(res.body.privacy_contact).toBe('privacidade@empresa.com');

    const tooLong = await request(app)
      .put('/api/v1/companies/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ privacyContact: 'x'.repeat(256) });
    expect(tooLong.status).toBe(400);
  });
});
