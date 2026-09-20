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
      .send({ vehicleId: otherVehicle.id, kmDeparture: 1000, departureGateId: gate.id });
    expect(res.status).toBe(400);
  });

  test('POST /fleet-logs com veículo bloqueado -> 403', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
    await db('vehicles').where({ id: vehicle.id }).update({ is_blocked: true, block_reason: 'Manutenção atrasada' });
    const res = await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleId: vehicle.id, kmDeparture: 1000, departureGateId: gate.id });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Manutenção atrasada/);
  });

  test('POST /fleet-logs com motorista bloqueado -> 403', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
    const driver = await createPerson({ companyId: company.id, isBlocked: true, blockReason: 'CNH vencida' });
    const res = await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleId: vehicle.id, kmDeparture: 1000, driverId: driver.id, departureGateId: gate.id });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/CNH vencida/);
  });

  test('transportingVehicleId igual ao próprio vehicleId -> 400 (não pode ser guincho de si mesmo)', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
    const res = await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleId: vehicle.id, kmDeparture: 1000, departureGateId: gate.id, transportingVehicleId: vehicle.id });
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
        kmDeparture: 1000,
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
      .send({ vehicleId: vehicle.id, kmDeparture: 1000, departureGateId: gate.id, transportingVehicleId: otherTowTruck.id });
    expect(res.status).toBe(400);
  });

  test('transportedByPlate de terceiro é normalizada (maiúsculas, sem traço)', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
    const res = await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleId: vehicle.id, kmDeparture: 1000, departureGateId: gate.id, transportedByPlate: 'xyz-9876' });
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
      .send({ vehicleId: vehicle.id, kmDeparture: 1000, departureGateId: gate.id, fuelLevelDeparture: 150 });
    expect(res.status).toBe(400);
  });

  test('GET /fleet-logs/on-trip só lista registros com status ON_TRIP', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
    const created = await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleId: vehicle.id, kmDeparture: 1000, departureGateId: gate.id });

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

    test('kmReturn menor que kmDeparture -> 400', async () => {
      const log = await registerDeparture({ kmDeparture: 2000 });
      const res = await request(app)
        .patch(`/api/v1/fleet-logs/${log.id}/return`)
        .set('Authorization', `Bearer ${token}`)
        .send({ returnGateId: gate.id, kmReturn: 1000 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/maior que o KM de saída \(2000\)/);
    });

    test('kmReturn IGUAL a kmDeparture -> 400 (só passa com "KM indisponível")', async () => {
      const log = await registerDeparture({ kmDeparture: 2000 });
      const res = await request(app)
        .patch(`/api/v1/fleet-logs/${log.id}/return`)
        .set('Authorization', `Bearer ${token}`)
        .send({ returnGateId: gate.id, kmReturn: 2000 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/maior que o KM de saída/);
    });

    test('sem kmReturn e sem isKmUnavailable -> 400 (KM de retorno obrigatório)', async () => {
      const log = await registerDeparture();
      const res = await request(app)
        .patch(`/api/v1/fleet-logs/${log.id}/return`)
        .set('Authorization', `Bearer ${token}`)
        .send({ returnGateId: gate.id });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/KM de retorno é obrigatório/);
    });

    test('isKmUnavailable dispensa o KM de retorno, grava NULL e liga o flag', async () => {
      const log = await registerDeparture({ kmDeparture: 2000 });
      const res = await request(app)
        .patch(`/api/v1/fleet-logs/${log.id}/return`)
        .set('Authorization', `Bearer ${token}`)
        .send({ returnGateId: gate.id, isKmUnavailable: true, kmReturn: 2000 });
      expect(res.status).toBe(200);
      expect(res.body.kmReturn).toBeNull();
      expect(res.body.isKmUnavailable).toBe(true);
      expect(res.body.kmDeparture).toBe(2000);
    });

    test('saída sem KM (indisponível): retorno com KM válido é aceito e o flag continua ligado', async () => {
      const log = await registerDeparture({ kmDeparture: undefined, isKmUnavailable: true });
      expect(log.kmDeparture).toBeNull();
      const res = await request(app)
        .patch(`/api/v1/fleet-logs/${log.id}/return`)
        .set('Authorization', `Bearer ${token}`)
        .send({ returnGateId: gate.id, kmReturn: 500 });
      expect(res.status).toBe(200);
      expect(res.body.kmReturn).toBe(500);
      expect(res.body.isKmUnavailable).toBe(true);
    });

    test('kmReturn não inteiro ou acima do teto -> 400 (não vira 500 do Postgres)', async () => {
      const log = await registerDeparture({ kmDeparture: 2000 });
      for (const kmReturn of [2100.5, -1, 99999999999]) {
        const res = await request(app)
          .patch(`/api/v1/fleet-logs/${log.id}/return`)
          .set('Authorization', `Bearer ${token}`)
          .send({ returnGateId: gate.id, kmReturn });
        expect(res.status).toBe(400);
      }
    });

    test('finalizar duas vezes -> 409 na segunda', async () => {
      const log = await registerDeparture();
      const first = await request(app)
        .patch(`/api/v1/fleet-logs/${log.id}/return`)
        .set('Authorization', `Bearer ${token}`)
        .send({ returnGateId: gate.id, kmReturn: 2100 });
      expect(first.status).toBe(200);

      const second = await request(app)
        .patch(`/api/v1/fleet-logs/${log.id}/return`)
        .set('Authorization', `Bearer ${token}`)
        .send({ returnGateId: gate.id, kmReturn: 2100 });
      expect(second.status).toBe(409);
    });
  });

  describe('KM de saída obrigatório', () => {
    test('POST /fleet-logs sem kmDeparture e sem isKmUnavailable -> 400', async () => {
      const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
      const res = await request(app)
        .post('/api/v1/fleet-logs')
        .set('Authorization', `Bearer ${token}`)
        .send({ vehicleId: vehicle.id, departureGateId: gate.id });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/KM de saída é obrigatório/);
    });

    test('POST /fleet-logs com isKmUnavailable dispensa o KM e grava NULL', async () => {
      const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
      const res = await request(app)
        .post('/api/v1/fleet-logs')
        .set('Authorization', `Bearer ${token}`)
        .send({ vehicleId: vehicle.id, departureGateId: gate.id, isKmUnavailable: true, kmDeparture: 123 });
      expect(res.status).toBe(201);
      expect(res.body.kmDeparture).toBeNull();
      expect(res.body.isKmUnavailable).toBe(true);
    });

    test('kmDeparture negativo, decimal ou acima do teto -> 400', async () => {
      const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
      for (const kmDeparture of [-5, 10.5, 'abc', 99999999999]) {
        const res = await request(app)
          .post('/api/v1/fleet-logs')
          .set('Authorization', `Bearer ${token}`)
          .send({ vehicleId: vehicle.id, departureGateId: gate.id, kmDeparture });
        expect(res.status).toBe(400);
      }
    });
  });

  describe('GET /fleet-logs/vehicles/:vehicleId/last-km', () => {
    test('veículo sem histórico -> lastKm null', async () => {
      const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
      const res = await request(app)
        .get(`/api/v1/fleet-logs/vehicles/${vehicle.id}/last-km`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ vehicleId: vehicle.id, lastKm: null });
    });

    test('devolve o KM de retorno da viagem mais recente (e a saída enquanto ela está em andamento)', async () => {
      const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
      const departure = (kmDeparture) =>
        request(app)
          .post('/api/v1/fleet-logs')
          .set('Authorization', `Bearer ${token}`)
          .send({ vehicleId: vehicle.id, departureGateId: gate.id, kmDeparture });
      const lastKm = async () =>
        (
          await request(app)
            .get(`/api/v1/fleet-logs/vehicles/${vehicle.id}/last-km`)
            .set('Authorization', `Bearer ${token}`)
        ).body.lastKm;

      const first = await departure(3000);
      expect(await lastKm()).toBe(3000);

      await request(app)
        .patch(`/api/v1/fleet-logs/${first.body.id}/return`)
        .set('Authorization', `Bearer ${token}`)
        .send({ returnGateId: gate.id, kmReturn: 3150 });
      expect(await lastKm()).toBe(3150);

      await departure(3150);
      expect(await lastKm()).toBe(3150);
    });

    test('veículo de OUTRA empresa -> 400', async () => {
      const otherCompany = await createCompany();
      const otherVehicle = await createVehicle({ companyId: otherCompany.id, vehicleType: 2 });
      const res = await request(app)
        .get(`/api/v1/fleet-logs/vehicles/${otherVehicle.id}/last-km`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });
  });

  test('GET /fleet-logs?search= encontra pelo destino (coluna própria, sem depender de motorista/veículo)', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: 2 });
    await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleId: vehicle.id, kmDeparture: 1000, departureGateId: gate.id, destination: 'Depósito Central Único' });

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
      .send({ vehicleId: otherVehicle.id, kmDeparture: 1000, departureGateId: otherGate.id });

    const res = await request(app).get(`/api/v1/fleet-logs/${created.body.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
