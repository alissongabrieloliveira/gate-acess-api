const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { signAccessToken } = require('../../src/utils/jwt');
const { encryptField } = require('../../src/utils/crypto');
const connectionRegistry = require('../../src/gatewayWs/connectionRegistry');
const {
  createCompany,
  createAdminUser,
  createRegularUser,
  createPerson,
  createVehicle,
  createGate,
} = require('../helpers/factories');

const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (hours) => new Date(Date.now() - hours * HOUR_MS);

function tokenFor(user, companyId) {
  return signAccessToken({ userId: user.id, companyId, rules: user.rules, mustChangePassword: false });
}

describe('GET /dashboard/alerts', () => {
  let company;
  let admin;
  let operator;
  let gate;
  let personInsideLong;
  let vehicleInsideLong;
  let fleetVehicleLong;
  let driver;
  let longAccessId;
  let longFleetId;
  let retroAccessId;
  let retroFleetId;

  beforeAll(async () => {
    company = await createCompany();
    const otherCompany = await createCompany();
    admin = await createAdminUser(company.id, { name: 'Admin Alertas' });
    operator = await createRegularUser(company.id, { name: 'Operador Alertas' });
    gate = await createGate({ companyId: company.id });
    const otherGate = await createGate({ companyId: otherCompany.id });
    const otherAdmin = await createAdminUser(otherCompany.id);

    personInsideLong = await createPerson({ companyId: company.id, name: 'Dentro Faz Tempo' });
    vehicleInsideLong = await createVehicle({ companyId: company.id });
    const personInsideShort = await createPerson({ companyId: company.id });
    const personFinished = await createPerson({ companyId: company.id });
    const personRetro = await createPerson({ companyId: company.id, name: 'Lançado Depois' });
    const otherPerson = await createPerson({ companyId: otherCompany.id });

    const access = (personId, overrides) => ({
      company_id: company.id,
      person_id: personId,
      entry_gate_id: gate.id,
      entry_operator_id: operator.id,
      ...overrides,
    });
    [{ id: longAccessId }] = await db('access_logs')
      .insert(access(personInsideLong.id, { entry_time: hoursAgo(13), vehicle_id: vehicleInsideLong.id, km_entry: 10 }))
      .returning('id');
    await db('access_logs').insert([
      // Dentro há pouco tempo: ainda não é alerta.
      access(personInsideShort.id, { entry_time: hoursAgo(11) }),
      // Antiga, mas já saiu.
      access(personFinished.id, { entry_time: hoursAgo(30), exit_time: hoursAgo(29), status: 'FINISHED' }),
      // Outra empresa.
      {
        company_id: otherCompany.id,
        person_id: otherPerson.id,
        entry_gate_id: otherGate.id,
        entry_operator_id: otherAdmin.id,
        entry_time: hoursAgo(40),
      },
    ]);
    // Entrada e saída lançadas juntas agora (retroativas) + uma antiga, fora da janela de 24h.
    [{ id: retroAccessId }] = await db('access_logs')
      .insert(
        access(personRetro.id, {
          entry_time: hoursAgo(50),
          exit_time: hoursAgo(49),
          status: 'FINISHED',
          entry_retroactive_reason_encrypted: encryptField('Esqueceu na correria'),
          exit_retroactive_reason_encrypted: encryptField('Esqueceu na correria'),
          exit_recorded_at: new Date(),
          entry_operator_id: admin.id,
          exit_operator_id: admin.id,
        })
      )
      .returning('id');
    await db('access_logs').insert(
      access(personRetro.id, {
        entry_time: hoursAgo(80),
        exit_time: hoursAgo(79),
        status: 'FINISHED',
        entry_retroactive_reason_encrypted: encryptField('Lançado faz tempo'),
        created_at: hoursAgo(48),
      })
    );

    driver = await createPerson({ companyId: company.id, name: 'Motorista Longe', personType: 3 });
    fleetVehicleLong = await createVehicle({ companyId: company.id, vehicleType: 2 });
    const fleetVehicleShort = await createVehicle({ companyId: company.id, vehicleType: 2 });
    const fleetVehicleRetro = await createVehicle({ companyId: company.id, vehicleType: 2 });
    const fleet = (vehicleId, overrides) => ({
      company_id: company.id,
      vehicle_id: vehicleId,
      driver_id: driver.id,
      departure_gate_id: gate.id,
      departure_operator_id: operator.id,
      km_departure: 100,
      destination: 'Goiânia - GO',
      ...overrides,
    });
    [{ id: longFleetId }] = await db('fleet_logs')
      .insert(fleet(fleetVehicleLong.id, { departure_time: hoursAgo(25) }))
      .returning('id');
    await db('fleet_logs').insert(fleet(fleetVehicleShort.id, { departure_time: hoursAgo(23) }));
    // Saída normal antiga, retorno lançado agora como retroativo pelo operador.
    [{ id: retroFleetId }] = await db('fleet_logs')
      .insert(
        fleet(fleetVehicleRetro.id, {
          departure_time: hoursAgo(72),
          created_at: hoursAgo(72),
          return_time: hoursAgo(70),
          return_gate_id: gate.id,
          return_operator_id: operator.id,
          km_return: 200,
          status: 'RETURNED',
          return_retroactive_reason_encrypted: encryptField('Voltou de madrugada'),
          return_recorded_at: new Date(),
        })
      )
      .returning('id');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await db.destroy();
  });

  const alerts = (user) =>
    request(app).get('/api/v1/dashboard/alerts').set('Authorization', `Bearer ${tokenFor(user, company.id)}`);

  test('exige autenticação', async () => {
    const res = await request(app).get('/api/v1/dashboard/alerts');
    expect(res.status).toBe(401);
  });

  test('pessoa dentro há mais de 12h e frota na rua há mais de 24h', async () => {
    const res = await alerts(operator);
    expect(res.status).toBe(200);
    expect(res.body.thresholds).toEqual({ personInsideHours: 12, fleetOnTripHours: 24 });

    expect(res.body.peopleInsideTooLong).toHaveLength(1);
    expect(res.body.peopleInsideTooLong[0]).toMatchObject({
      logId: longAccessId,
      person: { id: personInsideLong.id, name: 'Dentro Faz Tempo' },
      vehicle: { id: vehicleInsideLong.id, licensePlate: vehicleInsideLong.license_plate },
    });

    expect(res.body.fleetOnTripTooLong).toHaveLength(1);
    expect(res.body.fleetOnTripTooLong[0]).toMatchObject({
      logId: longFleetId,
      destination: 'Goiânia - GO',
      isCarried: false,
      vehicle: { id: fleetVehicleLong.id },
      driver: { id: driver.id, name: 'Motorista Longe' },
    });
  });

  test('o alerta some quando a saída é registrada', async () => {
    const person = await createPerson({ companyId: company.id });
    const [{ id }] = await db('access_logs')
      .insert({
        company_id: company.id,
        person_id: person.id,
        entry_gate_id: gate.id,
        entry_operator_id: operator.id,
        entry_time: hoursAgo(20),
      })
      .returning('id');
    expect((await alerts(operator)).body.peopleInsideTooLong.map((a) => a.logId)).toContain(id);

    await db('access_logs').where({ id }).update({ status: 'FINISHED', exit_time: new Date() });
    expect((await alerts(operator)).body.peopleInsideTooLong.map((a) => a.logId)).not.toContain(id);
  });

  test('lançamentos retroativos: null para o operador', async () => {
    const res = await alerts(operator);
    expect(res.body.recentRetroactive).toBeNull();
  });

  test('lançamentos retroativos das últimas 24h para o admin, pela hora real do lançamento', async () => {
    const res = await alerts(admin);
    expect(res.status).toBe(200);
    const items = res.body.recentRetroactive;
    expect(items.map((i) => [i.kind, i.logId]).sort()).toEqual(
      [
        ['ACCESS', retroAccessId],
        ['FLEET', retroFleetId],
      ].sort()
    );

    const accessItem = items.find((i) => i.kind === 'ACCESS');
    expect(accessItem.events.map((e) => e.event)).toEqual(['ENTRY', 'EXIT']);
    expect(accessItem.events[0].reason).toBe('Esqueceu na correria');
    expect(accessItem.operatorName).toBe('Admin Alertas');
    expect(accessItem.person.name).toBe('Lançado Depois');

    const fleetItem = items.find((i) => i.kind === 'FLEET');
    expect(fleetItem.events).toEqual([
      expect.objectContaining({ event: 'RETURN', reason: 'Voltou de madrugada' }),
    ]);
    expect(fleetItem.operatorName).toBe('Operador Alertas');
    expect(fleetItem.driver.name).toBe('Motorista Longe');
  });

  describe('gateway offline', () => {
    let deviceId;

    beforeAll(async () => {
      [{ id: deviceId }] = await db('gateway_devices')
        .insert({
          company_id: company.id,
          name: 'Gateway Portaria',
          token_hash: crypto.randomBytes(32).toString('hex'),
        })
        .returning('id');
    });

    test('sem conexão há mais de 2 minutos -> alerta', async () => {
      const since = new Date(Date.now() - 5 * 60 * 1000);
      jest.spyOn(connectionRegistry, 'getOfflineSince').mockImplementation((id) => (id === deviceId ? since : null));
      const res = await alerts(operator);
      expect(res.body.gatewayOffline).toMatchObject({ name: 'Gateway Portaria', offlineSince: since.toISOString() });
    });

    test('queda inesperada -> closedByOperatorAt null', async () => {
      jest.spyOn(connectionRegistry, 'getOfflineSince').mockReturnValue(new Date(Date.now() - 5 * 60 * 1000));
      expect((await alerts(operator)).body.gatewayOffline.closedByOperatorAt).toBeNull();
    });

    test('encerrado pelo operador -> alerta traz a hora do encerramento', async () => {
      const closedAt = new Date(Date.now() - 10 * 60 * 1000);
      await db('gateway_devices').where({ id: deviceId }).update({ closed_by_operator_at: closedAt });
      jest.spyOn(connectionRegistry, 'getOfflineSince').mockReturnValue(closedAt);
      const res = await alerts(operator);
      expect(res.body.gatewayOffline).toMatchObject({ closedByOperatorAt: closedAt.toISOString() });
      await db('gateway_devices').where({ id: deviceId }).update({ closed_by_operator_at: null });
    });

    test('caiu há menos de 2 minutos (reconexão) -> sem alerta', async () => {
      jest.spyOn(connectionRegistry, 'getOfflineSince').mockReturnValue(new Date(Date.now() - 30 * 1000));
      expect((await alerts(operator)).body.gatewayOffline).toBeNull();
    });

    test('conectado -> sem alerta', async () => {
      jest.spyOn(connectionRegistry, 'getOfflineSince').mockReturnValue(null);
      expect((await alerts(operator)).body.gatewayOffline).toBeNull();
    });

    test('gateway revogado não gera alerta', async () => {
      await db('gateway_devices').where({ id: deviceId }).update({ revoked_at: new Date() });
      jest.spyOn(connectionRegistry, 'getOfflineSince').mockReturnValue(new Date(0));
      expect((await alerts(operator)).body.gatewayOffline).toBeNull();
    });
  });
});
