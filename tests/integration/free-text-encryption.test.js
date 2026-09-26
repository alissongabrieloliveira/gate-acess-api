const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { signAccessToken } = require('../../src/utils/jwt');
const { createCompany, createAdminUser, createPerson, createVehicle, createGate } = require('../helpers/factories');

const VEHICLE_TYPE_FLEET = 2;

// LGPD: texto livre (motivo de bloqueio, observações, motivo da visita/saída)
// fica cifrado no banco e na trilha de auditoria; a API devolve em claro.
describe('Campos de texto livre criptografados', () => {
  let company;
  let token;
  let gate;

  beforeAll(async () => {
    company = await createCompany();
    const admin = await createAdminUser(company.id);
    token = signAccessToken({ userId: admin.id, companyId: company.id, rules: admin.rules, mustChangePassword: false });
    gate = await createGate({ companyId: company.id });
  });

  afterAll(async () => {
    await db.destroy();
  });

  const auth = (req) => req.set('Authorization', `Bearer ${token}`);

  async function expectNotInClear(table, id, text) {
    const row = await db(table).where({ id }).first();
    expect(JSON.stringify(row)).not.toContain(text);
    const audit = await db('audit_logs').where({ table_name: table, record_id: id });
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(text);
  }

  test('motivo de bloqueio de pessoa e de veículo', async () => {
    const person = await createPerson({ companyId: company.id });
    const blocked = await auth(request(app).patch(`/api/v1/people/${person.id}/block`)).send({
      isBlocked: true,
      reason: 'Ameaçou o porteiro',
    });
    expect(blocked.status).toBe(200);
    expect(blocked.body.blockReason).toBe('Ameaçou o porteiro');
    await expectNotInClear('people', person.id, 'Ameaçou');

    const vehicle = await createVehicle({ companyId: company.id });
    const vBlocked = await auth(request(app).patch(`/api/v1/vehicles/${vehicle.id}/block`)).send({
      isBlocked: true,
      reason: 'Placa clonada',
    });
    expect(vBlocked.status).toBe(200);
    expect(vBlocked.body.blockReason).toBe('Placa clonada');
    await expectNotInClear('vehicles', vehicle.id, 'clonada');
  });

  test('motivo da visita e observações do acesso', async () => {
    const person = await createPerson({ companyId: company.id });
    const created = await auth(request(app).post('/api/v1/access-logs')).send({
      personId: person.id,
      entryGateId: gate.id,
      visitReason: 'Consulta médica',
      observation: 'Chegou com acompanhante',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ visitReason: 'Consulta médica', observation: 'Chegou com acompanhante' });

    const exited = await auth(request(app).patch(`/api/v1/access-logs/${created.body.id}/exit`)).send({
      exitGateId: gate.id,
      observation: 'Saiu passando mal',
    });
    expect(exited.status).toBe(200);
    expect(exited.body.observation).toBe('Saiu passando mal');

    const fetched = await auth(request(app).get(`/api/v1/access-logs/${created.body.id}`));
    expect(fetched.body).toMatchObject({ visitReason: 'Consulta médica', observation: 'Saiu passando mal' });

    await expectNotInClear('access_logs', created.body.id, 'médica');
    await expectNotInClear('access_logs', created.body.id, 'acompanhante');
    await expectNotInClear('access_logs', created.body.id, 'passando mal');
  });

  test('motivo da visita acima de 255 caracteres é recusado', async () => {
    const person = await createPerson({ companyId: company.id });
    const res = await auth(request(app).post('/api/v1/access-logs')).send({
      personId: person.id,
      entryGateId: gate.id,
      visitReason: 'x'.repeat(256),
    });
    expect(res.status).toBe(400);
  });

  test('motivo e observações da frota', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: VEHICLE_TYPE_FLEET });
    const created = await auth(request(app).post('/api/v1/fleet-logs')).send({
      vehicleId: vehicle.id,
      departureGateId: gate.id,
      kmDeparture: 1000,
      purpose: 'Levar funcionário ao hospital',
      observation: 'Motorista reclamou de dor',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ purpose: 'Levar funcionário ao hospital', observation: 'Motorista reclamou de dor' });

    const edited = await auth(request(app).put(`/api/v1/fleet-logs/${created.body.id}`)).send({ purpose: 'Entrega no hospital' });
    expect(edited.status).toBe(200);
    expect(edited.body.purpose).toBe('Entrega no hospital');

    await expectNotInClear('fleet_logs', created.body.id, 'hospital');
    await expectNotInClear('fleet_logs', created.body.id, 'reclamou de dor');

    const tooLong = await auth(request(app).post('/api/v1/fleet-logs')).send({
      vehicleId: (await createVehicle({ companyId: company.id, vehicleType: VEHICLE_TYPE_FLEET })).id,
      departureGateId: gate.id,
      kmDeparture: 1000,
      purpose: 'x'.repeat(256),
    });
    expect(tooLong.status).toBe(400);
  });
});
