const { encryptField } = require('../../src/utils/crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { signAccessToken } = require('../../src/utils/jwt');
const {
  createCompany,
  createAdminUser,
  createUser,
  createPerson,
  createVehicle,
  createGate,
  createCity,
} = require('../helpers/factories');

const PERSON_TYPE_EMPLOYEE = 3;

describe('Controle de Frota (fleet-logs) — saída, retorno, guincho e não retorno', () => {
  let company;
  let admin;
  let token;
  let gate;
  let driver;
  let city;

  beforeAll(async () => {
    company = await createCompany();
    admin = await createAdminUser(company.id);
    token = signAccessToken({ userId: admin.id, companyId: company.id, rules: admin.rules, mustChangePassword: false });
    gate = await createGate({ companyId: company.id });
    driver = await createPerson({ companyId: company.id, name: 'Motorista Frota', personType: PERSON_TYPE_EMPLOYEE });
    city = await createCity({ name: 'Vila Propício', stateAbbr: 'GO' });
  });

  afterAll(async () => {
    await db.destroy();
  });

  const fleetVehicle = () => createVehicle({ companyId: company.id, vehicleType: 2 });

  // Saída válida com motorista — cada teste só sobrescreve o que interessa.
  function postDeparture(body, authToken = token) {
    return request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ driverId: driver.id, departureGateId: gate.id, kmDeparture: 1000, destinationCityId: city.id, ...body });
  }

  function postReturn(id, body) {
    return request(app).patch(`/api/v1/fleet-logs/${id}/return`).set('Authorization', `Bearer ${token}`).send(body);
  }

  test('POST /fleet-logs sem vehicleId/departureGateId -> 400', async () => {
    const res = await request(app).post('/api/v1/fleet-logs').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  test('POST /fleet-logs sem motorista -> 400', async () => {
    const vehicle = await fleetVehicle();
    const res = await postDeparture({ vehicleId: vehicle.id, driverId: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/motorista/i);
  });

  test('POST /fleet-logs referenciando veículo de OUTRA empresa -> 400', async () => {
    const otherCompany = await createCompany();
    const otherVehicle = await createVehicle({ companyId: otherCompany.id, vehicleType: 2 });
    const res = await postDeparture({ vehicleId: otherVehicle.id });
    expect(res.status).toBe(400);
  });

  test('POST /fleet-logs com veículo que não é da frota própria -> 400', async () => {
    const visitorVehicle = await createVehicle({ companyId: company.id, vehicleType: 1 });
    const res = await postDeparture({ vehicleId: visitorVehicle.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Frota Própria/);
  });

  test('POST /fleet-logs com veículo bloqueado -> 403', async () => {
    const vehicle = await fleetVehicle();
    await db('vehicles').where({ id: vehicle.id }).update({ is_blocked: true, block_reason_encrypted: encryptField('Manutenção atrasada') });
    const res = await postDeparture({ vehicleId: vehicle.id });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Manutenção atrasada/);
  });

  test('POST /fleet-logs com motorista bloqueado -> 403', async () => {
    const vehicle = await fleetVehicle();
    const blockedDriver = await createPerson({ companyId: company.id, isBlocked: true, blockReason: 'CNH vencida' });
    const res = await postDeparture({ vehicleId: vehicle.id, driverId: blockedDriver.id });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/CNH vencida/);
  });

  test('POST /fleet-logs registra a saída e ignora departureOperatorId enviado pelo cliente', async () => {
    const vehicle = await fleetVehicle();
    const otherAdmin = await createAdminUser(company.id);
    const res = await postDeparture({
      vehicleId: vehicle.id,
      departureOperatorId: otherAdmin.id,
      destinationCityId: city.id,
      kmDeparture: 5000,
      fuelLevelDeparture: 80,
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ON_TRIP');
    expect(res.body.destination).toBe('Vila Propício - GO');
    expect(res.body.driverId).toBe(driver.id);
    expect(res.body.departureOperatorId).toBe(admin.id);
  });

  test('destino obrigatório e só da lista de cidades: vazio, texto livre ou cidade inexistente -> 400', async () => {
    const vehicle = await fleetVehicle();
    const freeText = await postDeparture({ vehicleId: vehicle.id, destination: 'Vila' });
    expect(freeText.status).toBe(400);
    expect(freeText.body.error).toMatch(/lista de cidades/);
    expect((await postDeparture({ vehicleId: vehicle.id, destinationCityId: 999999999 })).status).toBe(400);
    expect((await postDeparture({ vehicleId: vehicle.id, destinationCityId: 'abc' })).status).toBe(400);
    const noDestination = await postDeparture({ vehicleId: vehicle.id, destinationCityId: undefined });
    expect(noDestination.status).toBe(400);
    expect(noDestination.body.error).toMatch(/Informe o destino/);
    expect((await postDeparture({ vehicleId: vehicle.id, destinationCityId: null })).status).toBe(400);
  });

  test('veículo que já está na rua não pode ter outra saída -> 409', async () => {
    const vehicle = await fleetVehicle();
    const first = await postDeparture({ vehicleId: vehicle.id });
    expect(first.status).toBe(201);

    const second = await postDeparture({ vehicleId: vehicle.id });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/já está fora/);

    await postReturn(first.body.id, { returnGateId: gate.id, kmReturn: 1100 });
    const afterReturn = await postDeparture({ vehicleId: vehicle.id, kmDeparture: 1100 });
    expect(afterReturn.status).toBe(201);
  });

  test('nível de combustível fora de 0-100 -> 400 (CHECK chk_fuel_level mapeado)', async () => {
    const vehicle = await fleetVehicle();
    const res = await postDeparture({ vehicleId: vehicle.id, fuelLevelDeparture: 150 });
    expect(res.status).toBe(400);
  });

  test('GET /fleet-logs/on-trip só lista registros com status ON_TRIP', async () => {
    const vehicle = await fleetVehicle();
    const created = await postDeparture({ vehicleId: vehicle.id });
    const res = await request(app).get('/api/v1/fleet-logs/on-trip').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((l) => l.id)).toContain(created.body.id);
    expect(res.body.data.every((l) => l.status === 'ON_TRIP')).toBe(true);
  });

  describe('guincho da frota levando outro veículo', () => {
    test('veículo da frota em cima: ganha registro próprio, sem motorista, na rua', async () => {
      const towTruck = await fleetVehicle();
      const carried = await fleetVehicle();
      // Histórico do transportado: a saída dele herda o último KM conhecido.
      const past = await postDeparture({ vehicleId: carried.id, kmDeparture: 7000 });
      await postReturn(past.body.id, { returnGateId: gate.id, kmReturn: 7200 });

      const res = await postDeparture({ vehicleId: towTruck.id, carriedVehicleId: carried.id, destinationCityId: city.id });
      expect(res.status).toBe(201);
      expect(res.body.vehicleId).toBe(towTruck.id);
      expect(res.body.driverId).toBe(driver.id);

      const carriedLog = await db('fleet_logs').where({ transport_log_id: res.body.id }).first();
      expect(carriedLog).toMatchObject({
        vehicle_id: carried.id,
        driver_id: null,
        transporting_vehicle_id: towTruck.id,
        status: 'ON_TRIP',
        km_departure: 7200,
        destination: 'Vila Propício - GO',
      });

      const detail = await request(app).get(`/api/v1/fleet-logs/${res.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(detail.body.carriedLogs).toEqual([
        expect.objectContaining({ id: carriedLog.id, status: 'ON_TRIP', vehicle: expect.objectContaining({ id: carried.id }) }),
      ]);

      // Guincho volta; o transportado continua fora e volta depois, rodando.
      const towBack = await postReturn(res.body.id, { returnGateId: gate.id, kmReturn: 1050 });
      expect(towBack.status).toBe(200);
      const stillOut = await postDeparture({ vehicleId: carried.id, kmDeparture: 7200 });
      expect(stillOut.status).toBe(409);
      const carriedBack = await postReturn(carriedLog.id, { returnGateId: gate.id, kmReturn: 7230 });
      expect(carriedBack.status).toBe(200);
      expect(carriedBack.body.status).toBe('RETURNED');
    });

    test('veículo de terceiro em cima: só a placa, normalizada', async () => {
      const towTruck = await fleetVehicle();
      const res = await postDeparture({ vehicleId: towTruck.id, carriedVehiclePlate: 'xyz-9876' });
      expect(res.status).toBe(201);
      expect(res.body.carriedVehiclePlate).toBe('XYZ9876');
      expect(await db('fleet_logs').where({ transport_log_id: res.body.id }).first()).toBeUndefined();
    });

    test('transportado igual ao próprio guincho -> 400', async () => {
      const towTruck = await fleetVehicle();
      const res = await postDeparture({ vehicleId: towTruck.id, carriedVehicleId: towTruck.id });
      expect(res.status).toBe(400);
    });

    test('carriedVehicleId e carriedVehiclePlate juntos -> 400', async () => {
      const towTruck = await fleetVehicle();
      const carried = await fleetVehicle();
      const res = await postDeparture({ vehicleId: towTruck.id, carriedVehicleId: carried.id, carriedVehiclePlate: 'XYZ9876' });
      expect(res.status).toBe(400);
    });

    test('transportado de OUTRA empresa -> 400', async () => {
      const towTruck = await fleetVehicle();
      const otherCompany = await createCompany();
      const otherVehicle = await createVehicle({ companyId: otherCompany.id, vehicleType: 2 });
      const res = await postDeparture({ vehicleId: towTruck.id, carriedVehicleId: otherVehicle.id });
      expect(res.status).toBe(400);
    });

    test('transportado que já está na rua -> 409 e nada é gravado', async () => {
      const towTruck = await fleetVehicle();
      const carried = await fleetVehicle();
      await postDeparture({ vehicleId: carried.id });
      const res = await postDeparture({ vehicleId: towTruck.id, carriedVehicleId: carried.id });
      expect(res.status).toBe(409);
      expect(await db('fleet_logs').where({ vehicle_id: towTruck.id }).first()).toBeUndefined();
    });
  });

  describe('veículo que não retorna (vendido/transferido)', () => {
    test('transportado vendido: registro nasce NO_RETURN e o cadastro fica marcado', async () => {
      const towTruck = await fleetVehicle();
      const carried = await fleetVehicle();
      const res = await postDeparture({ vehicleId: towTruck.id, carriedVehicleId: carried.id, carriedNoReturnReason: 'SOLD' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ON_TRIP');

      const carriedLog = await db('fleet_logs').where({ transport_log_id: res.body.id }).first();
      expect(carriedLog).toMatchObject({ status: 'NO_RETURN', no_return_reason: 'SOLD' });
      expect((await db('vehicles').where({ id: carried.id }).first()).operation_status).toBe('SOLD');

      const again = await postDeparture({ vehicleId: carried.id });
      expect(again.status).toBe(409);
      expect(again.body.error).toMatch(/vendido\/transferido/);

      const returnIt = await postReturn(carriedLog.id, { returnGateId: gate.id, kmReturn: 99999 });
      expect(returnIt.status).toBe(409);
    });

    test('veículo saindo rodando transferido para a matriz', async () => {
      const vehicle = await fleetVehicle();
      const res = await postDeparture({ vehicleId: vehicle.id, noReturnReason: 'TRANSFERRED_HQ' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'NO_RETURN', noReturnReason: 'TRANSFERRED_HQ' });
      expect((await db('vehicles').where({ id: vehicle.id }).first()).operation_status).toBe('TRANSFERRED_HQ');
    });

    test('motivo inválido -> 400; motivo do transportado sem transportado da frota -> 400', async () => {
      const vehicle = await fleetVehicle();
      expect((await postDeparture({ vehicleId: vehicle.id, noReturnReason: 'LOST' })).status).toBe(400);
      expect((await postDeparture({ vehicleId: vehicle.id, carriedNoReturnReason: 'SOLD' })).status).toBe(400);
    });

    test('reativar o veículo (operationStatus ACTIVE) é só admin', async () => {
      const vehicle = await fleetVehicle();
      await postDeparture({ vehicleId: vehicle.id, noReturnReason: 'TRANSFERRED_BRANCH' });

      const operator = await createUser({ companyId: company.id, rules: 0 });
      const operatorToken = signAccessToken({ userId: operator.id, companyId: company.id, rules: 0, mustChangePassword: false });
      const denied = await request(app)
        .put(`/api/v1/vehicles/${vehicle.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ operationStatus: 'ACTIVE' });
      expect(denied.status).toBe(403);

      const invalid = await request(app)
        .put(`/api/v1/vehicles/${vehicle.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ operationStatus: 'WHATEVER' });
      expect(invalid.status).toBe(400);

      const ok = await request(app)
        .put(`/api/v1/vehicles/${vehicle.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ operationStatus: 'ACTIVE' });
      expect(ok.status).toBe(200);
      expect((await postDeparture({ vehicleId: vehicle.id })).status).toBe(201);
    });
  });

  describe('PUT /:id (admin) — motorista', () => {
    test('atribui motorista a um registro antigo que ficou sem', async () => {
      const vehicle = await fleetVehicle();
      const [legacy] = await db('fleet_logs')
        .insert({
          company_id: company.id,
          vehicle_id: vehicle.id,
          departure_gate_id: gate.id,
          departure_operator_id: admin.id,
          km_departure: 100,
        })
        .returning('*');
      const res = await request(app)
        .put(`/api/v1/fleet-logs/${legacy.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ driverId: driver.id });
      expect(res.status).toBe(200);
      expect(res.body.driverId).toBe(driver.id);
    });

    test('registro do veículo transportado não aceita motorista -> 400', async () => {
      const towTruck = await fleetVehicle();
      const carried = await fleetVehicle();
      const tow = await postDeparture({ vehicleId: towTruck.id, carriedVehicleId: carried.id });
      const carriedLog = await db('fleet_logs').where({ transport_log_id: tow.body.id }).first();
      const res = await request(app)
        .put(`/api/v1/fleet-logs/${carriedLog.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ driverId: driver.id });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /:id/return', () => {
    async function registerDeparture(overrides = {}) {
      const vehicle = await fleetVehicle();
      const res = await postDeparture({ vehicleId: vehicle.id, kmDeparture: 2000, ...overrides });
      return res.body;
    }

    test('sem returnGateId -> 400', async () => {
      const log = await registerDeparture();
      const res = await postReturn(log.id, {});
      expect(res.status).toBe(400);
    });

    test('registra o retorno com sucesso (status vira RETURNED)', async () => {
      const log = await registerDeparture();
      const res = await postReturn(log.id, { returnGateId: gate.id, kmReturn: 2100, fuelLevelReturn: 40, observation: 'Retorno normal' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('RETURNED');
      expect(res.body.kmReturn).toBe(2100);
      expect(res.body.fuelLevelReturn).toBe(40);
    });

    test('kmReturn menor que kmDeparture -> 400', async () => {
      const log = await registerDeparture({ kmDeparture: 2000 });
      const res = await postReturn(log.id, { returnGateId: gate.id, kmReturn: 1000 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/maior que o KM de saída \(2000\)/);
    });

    test('kmReturn IGUAL a kmDeparture -> 400 (só passa com "KM indisponível")', async () => {
      const log = await registerDeparture({ kmDeparture: 2000 });
      const res = await postReturn(log.id, { returnGateId: gate.id, kmReturn: 2000 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/maior que o KM de saída/);
    });

    test('sem kmReturn e sem isKmUnavailable -> 400 (KM de retorno obrigatório)', async () => {
      const log = await registerDeparture();
      const res = await postReturn(log.id, { returnGateId: gate.id });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/KM de retorno é obrigatório/);
    });

    test('isKmUnavailable dispensa o KM de retorno, grava NULL e liga o flag', async () => {
      const log = await registerDeparture({ kmDeparture: 2000 });
      const res = await postReturn(log.id, { returnGateId: gate.id, isKmUnavailable: true, kmReturn: 2000 });
      expect(res.status).toBe(200);
      expect(res.body.kmReturn).toBeNull();
      expect(res.body.isKmUnavailable).toBe(true);
      expect(res.body.kmDeparture).toBe(2000);
    });

    test('saída sem KM (indisponível): retorno com KM válido é aceito e o flag continua ligado', async () => {
      const log = await registerDeparture({ kmDeparture: undefined, isKmUnavailable: true });
      expect(log.kmDeparture).toBeNull();
      const res = await postReturn(log.id, { returnGateId: gate.id, kmReturn: 500 });
      expect(res.status).toBe(200);
      expect(res.body.kmReturn).toBe(500);
      expect(res.body.isKmUnavailable).toBe(true);
    });

    test('kmReturn não inteiro ou acima do teto -> 400 (não vira 500 do Postgres)', async () => {
      const log = await registerDeparture({ kmDeparture: 2000 });
      for (const kmReturn of [2100.5, -1, 99999999999]) {
        const res = await postReturn(log.id, { returnGateId: gate.id, kmReturn });
        expect(res.status).toBe(400);
      }
    });

    test('finalizar duas vezes -> 409 na segunda', async () => {
      const log = await registerDeparture();
      const first = await postReturn(log.id, { returnGateId: gate.id, kmReturn: 2100 });
      expect(first.status).toBe(200);
      const second = await postReturn(log.id, { returnGateId: gate.id, kmReturn: 2100 });
      expect(second.status).toBe(409);
    });
  });

  describe('KM de saída obrigatório', () => {
    test('POST /fleet-logs sem kmDeparture e sem isKmUnavailable -> 400', async () => {
      const vehicle = await fleetVehicle();
      const res = await postDeparture({ vehicleId: vehicle.id, kmDeparture: undefined });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/KM de saída é obrigatório/);
    });

    test('POST /fleet-logs com isKmUnavailable dispensa o KM e grava NULL', async () => {
      const vehicle = await fleetVehicle();
      const res = await postDeparture({ vehicleId: vehicle.id, isKmUnavailable: true, kmDeparture: 123 });
      expect(res.status).toBe(201);
      expect(res.body.kmDeparture).toBeNull();
      expect(res.body.isKmUnavailable).toBe(true);
    });

    test('kmDeparture negativo, decimal ou acima do teto -> 400', async () => {
      const vehicle = await fleetVehicle();
      for (const kmDeparture of [-5, 10.5, 'abc', 99999999999]) {
        const res = await postDeparture({ vehicleId: vehicle.id, kmDeparture });
        expect(res.status).toBe(400);
      }
    });
  });

  describe('GET /fleet-logs/vehicles/:vehicleId/last-km', () => {
    test('veículo sem histórico -> lastKm null', async () => {
      const vehicle = await fleetVehicle();
      const res = await request(app)
        .get(`/api/v1/fleet-logs/vehicles/${vehicle.id}/last-km`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ vehicleId: vehicle.id, lastKm: null });
    });

    test('devolve o KM de retorno da viagem mais recente (e a saída enquanto ela está em andamento)', async () => {
      const vehicle = await fleetVehicle();
      const lastKm = async () =>
        (
          await request(app)
            .get(`/api/v1/fleet-logs/vehicles/${vehicle.id}/last-km`)
            .set('Authorization', `Bearer ${token}`)
        ).body.lastKm;

      const first = await postDeparture({ vehicleId: vehicle.id, kmDeparture: 3000 });
      expect(await lastKm()).toBe(3000);

      await postReturn(first.body.id, { returnGateId: gate.id, kmReturn: 3150 });
      expect(await lastKm()).toBe(3150);

      await postDeparture({ vehicleId: vehicle.id, kmDeparture: 3150 });
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
    const vehicle = await fleetVehicle();
    const uniqueCity = await createCity({ name: 'Cidade Única da Busca', stateAbbr: 'MT' });
    await postDeparture({ vehicleId: vehicle.id, destinationCityId: uniqueCity.id });

    const res = await request(app)
      .get('/api/v1/fleet-logs')
      .query({ search: 'Única da Busca' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((l) => l.destination === 'Cidade Única da Busca - MT')).toBe(true);
  });

  test('GET /fleet-logs?search= encontra pelo número de identificação do veículo', async () => {
    const vehicle = await fleetVehicle();
    await db('vehicles').where({ id: vehicle.id }).update({ identification_code: 'FR-9087' });
    const created = await postDeparture({ vehicleId: vehicle.id });

    const res = await request(app)
      .get('/api/v1/fleet-logs')
      .query({ search: 'fr9087' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((l) => l.id)).toContain(created.body.id);
  });

  test('registro de outra empresa não é visível (isolamento de tenant)', async () => {
    const otherCompany = await createCompany();
    const otherAdmin = await createAdminUser(otherCompany.id);
    const otherGate = await createGate({ companyId: otherCompany.id });
    const otherVehicle = await createVehicle({ companyId: otherCompany.id, vehicleType: 2 });
    const otherDriver = await createPerson({ companyId: otherCompany.id, personType: PERSON_TYPE_EMPLOYEE });
    const otherToken = signAccessToken({
      userId: otherAdmin.id,
      companyId: otherCompany.id,
      rules: otherAdmin.rules,
      mustChangePassword: false,
    });
    const created = await request(app)
      .post('/api/v1/fleet-logs')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        vehicleId: otherVehicle.id,
        driverId: otherDriver.id,
        kmDeparture: 1000,
        departureGateId: otherGate.id,
        destinationCityId: city.id,
      });
    expect(created.status).toBe(201);

    const res = await request(app).get(`/api/v1/fleet-logs/${created.body.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
