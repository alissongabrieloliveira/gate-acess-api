const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { signAccessToken } = require('../../src/utils/jwt');
const { createCompany, createAdminUser, createPerson, createVehicle, createGate } = require('../helpers/factories');

describe('Controle de Frota (fleet-logs) — saída, retorno e guincho', () => {
  let company;
  let admin;
  let token;
  let gate;

  beforeAll(async () => {
    company = await createCompany();
    admin = await createAdminUser(company.id);
    token = signAccessToken({ userId: admin.id, companyId: company.id, rules: admin.rules, mustChangePassword: false });
    gate = await createGate({ companyId: company.id });
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('POST /fleet-logs sem vehicleId/departureGateId -> 400', async () => {
    const res = await request(app).post('/api/v1/fleet-logs').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  test('POST /fleet-logs referenciando veículo de OUTRA empresa -> 400', async () => {
    const otherCompany = await createCompany();
    const otherVehicle = await createVehicle({ companyId: otherCompany.id });
    const res = await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleId: otherVehicle.id, departureGateId: gate.id });
    expect(res.status).toBe(400);
  });

  test('POST /fleet-logs com veículo bloqueado -> 403', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
    await db('vehicles').where({ id: vehicle.id }).update({ is_blocked: true, block_reason: 'Manutenção atrasada' });
    const res = await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleId: vehicle.id, departureGateId: gate.id });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Manutenção atrasada/);
  });

  test('POST /fleet-logs com motorista bloqueado -> 403', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
    const driver = await createPerson({ companyId: company.id, isBlocked: true, blockReason: 'CNH vencida' });
    const res = await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleId: vehicle.id, driverId: driver.id, departureGateId: gate.id });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/CNH vencida/);
  });

  test('transportingVehicleId igual ao próprio vehicleId -> 400 (não pode ser guincho de si mesmo)', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
    const res = await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleId: vehicle.id, departureGateId: gate.id, transportingVehicleId: vehicle.id });
    expect(res.status).toBe(400);
  });

  test('transportingVehicleId e transportedByPlate juntos -> 400 (mutuamente exclusivos)', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
    const towTruck = await createVehicle({ companyId: company.id, vehicleType: 2 });
    const res = await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vehicleId: vehicle.id,
        departureGateId: gate.id,
        transportingVehicleId: towTruck.id,
        transportedByPlate: 'XYZ-9876',
      });
    expect(res.status).toBe(400);
  });

  test('transportingVehicleId de OUTRA empresa -> 400', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
    const otherCompany = await createCompany();
    const otherTowTruck = await createVehicle({ companyId: otherCompany.id });
    const res = await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleId: vehicle.id, departureGateId: gate.id, transportingVehicleId: otherTowTruck.id });
    expect(res.status).toBe(400);
  });

  test('transportedByPlate de terceiro é normalizada (maiúsculas, sem traço)', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
    const res = await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleId: vehicle.id, departureGateId: gate.id, transportedByPlate: 'xyz-9876' });
    expect(res.status).toBe(201);
    expect(res.body.transportedByPlate).toBe('XYZ9876');
  });

  test('POST /fleet-logs registra a saída e ignora departureOperatorId enviado pelo cliente', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
    const otherAdmin = await createAdminUser(company.id);

    const res = await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vehicleId: vehicle.id,
        departureGateId: gate.id,
        departureOperatorId: otherAdmin.id,
        destination: 'Filial Sul',
        kmDeparture: 5000,
        fuelLevelDeparture: 80,
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ON_TRIP');
    expect(res.body.departureOperatorId).toBe(admin.id);
    expect(res.body.departureOperatorId).not.toBe(otherAdmin.id);
  });

  test('nível de combustível fora de 0-100 -> 400 (CHECK chk_fuel_level mapeado)', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
    const res = await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleId: vehicle.id, departureGateId: gate.id, fuelLevelDeparture: 150 });
    expect(res.status).toBe(400);
  });

  test('GET /fleet-logs/on-trip só lista registros com status ON_TRIP', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
    const created = await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleId: vehicle.id, departureGateId: gate.id });

    const res = await request(app).get('/api/v1/fleet-logs/on-trip').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((l) => l.id)).toContain(created.body.id);
    expect(res.body.data.every((l) => l.status === 'ON_TRIP')).toBe(true);
  });

  describe('PATCH /:id/return', () => {
    async function registerDeparture(overrides = {}) {
      const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
      const res = await request(app)
        .post('/api/v1/fleet-logs')
        .set('Authorization', `Bearer ${token}`)
        .send({ vehicleId: vehicle.id, departureGateId: gate.id, kmDeparture: 2000, ...overrides });
      return res.body;
    }

    test('sem returnGateId -> 400', async () => {
      const log = await registerDeparture();
      const res = await request(app).patch(`/api/v1/fleet-logs/${log.id}/return`).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(400);
    });

    test('registra o retorno com sucesso (status vira RETURNED)', async () => {
      const log = await registerDeparture();
      const res = await request(app)
        .patch(`/api/v1/fleet-logs/${log.id}/return`)
        .set('Authorization', `Bearer ${token}`)
        .send({ returnGateId: gate.id, kmReturn: 2100, fuelLevelReturn: 40, observation: 'Retorno normal' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('RETURNED');
      expect(res.body.kmReturn).toBe(2100);
      expect(res.body.fuelLevelReturn).toBe(40);
    });

    test('kmReturn menor que kmDeparture -> 400 (CHECK chk_fleet_km_logic mapeado)', async () => {
      const log = await registerDeparture({ kmDeparture: 2000 });
      const res = await request(app)
        .patch(`/api/v1/fleet-logs/${log.id}/return`)
        .set('Authorization', `Bearer ${token}`)
        .send({ returnGateId: gate.id, kmReturn: 1000 });
      expect(res.status).toBe(400);
    });

    test('finalizar duas vezes -> 409 na segunda', async () => {
      const log = await registerDeparture();
      const first = await request(app)
        .patch(`/api/v1/fleet-logs/${log.id}/return`)
        .set('Authorization', `Bearer ${token}`)
        .send({ returnGateId: gate.id });
      expect(first.status).toBe(200);

      const second = await request(app)
        .patch(`/api/v1/fleet-logs/${log.id}/return`)
        .set('Authorization', `Bearer ${token}`)
        .send({ returnGateId: gate.id });
      expect(second.status).toBe(409);
    });
  });

  test('GET /fleet-logs?search= encontra pelo destino (coluna própria, sem depender de motorista/veículo)', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
    await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleId: vehicle.id, departureGateId: gate.id, destination: 'Depósito Central Único' });

    const res = await request(app)
      .get('/api/v1/fleet-logs')
      .query({ search: 'Depósito Central' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((l) => l.destination === 'Depósito Central Único')).toBe(true);
  });

  test('registro de outra empresa não é visível (isolamento de tenant)', async () => {
    const otherCompany = await createCompany();
    const otherAdmin = await createAdminUser(otherCompany.id);
    const otherGate = await createGate({ companyId: otherCompany.id });
    const otherVehicle = await createVehicle({ companyId: otherCompany.id, vehicleType: 2 });
    const otherToken = signAccessToken({
      userId: otherAdmin.id,
      companyId: otherCompany.id,
      rules: otherAdmin.rules,
      mustChangePassword: false,
    });
    const created = await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ vehicleId: otherVehicle.id, departureGateId: otherGate.id });

    const res = await request(app).get(`/api/v1/fleet-logs/${created.body.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
