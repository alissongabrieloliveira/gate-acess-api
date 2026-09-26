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

const PERSON_TYPE_EMPLOYEE = 3;
const VEHICLE_TYPE_FLEET = 2;

// Antes o frontend resolvia nomes/placas contra uma amostra de até 100
// cadastros; agora cada registro já vem com os dados de exibição anexados.
describe('Registros de acesso/frota trazem os dados relacionados (sem amostra de 100)', () => {
  let company;
  let token;
  let gate;

  beforeAll(async () => {
    company = await createCompany();
    const admin = await createAdminUser(company.id);
    token = signAccessToken({ userId: admin.id, companyId: company.id, rules: admin.rules, mustChangePassword: false });
    gate = await createGate({ companyId: company.id, name: 'Portaria Norte' });
  });

  afterAll(async () => {
    await db.destroy();
  });

  const auth = (req) => req.set('Authorization', `Bearer ${token}`);

  test('acesso de pessoa cadastrada depois de outras 100 vem com nome, CPF, veículo, setor e portão', async () => {
    for (let i = 0; i < 100; i += 1) {
      await createPerson({ companyId: company.id, name: `Pessoa ${i}` });
    }
    const person = await createPerson({ companyId: company.id, name: 'Zélia Depois das Cem', personType: PERSON_TYPE_EMPLOYEE });
    const host = await createPerson({ companyId: company.id, name: 'Anfitriã Teste', personType: PERSON_TYPE_EMPLOYEE });
    const vehicle = await createVehicle({ companyId: company.id, licensePlate: 'ZZZ1A23' });
    const sector = await createSector({ companyId: company.id, name: 'Almoxarifado' });

    const created = await auth(request(app).post('/api/v1/access-logs')).send({
      personId: person.id,
      visitedPersonId: host.id,
      vehicleId: vehicle.id,
      destinationSectorId: sector.id,
      entryGateId: gate.id,
      kmEntry: 100,
    });
    expect(created.status).toBe(201);

    const list = await auth(request(app).get('/api/v1/access-logs')).query({ limit: 1 });
    expect(list.status).toBe(200);
    expect(list.body.data[0]).toMatchObject({
      id: created.body.id,
      person: { id: person.id, name: 'Zélia Depois das Cem', cpf: person.cpf, personType: PERSON_TYPE_EMPLOYEE },
      visitedPerson: { id: host.id, name: 'Anfitriã Teste' },
      vehicle: { id: vehicle.id, licensePlate: 'ZZZ1A23' },
      destinationSector: { id: sector.id, name: 'Almoxarifado' },
      entryGate: { id: gate.id, name: 'Portaria Norte' },
      exitGate: null,
    });

    const active = await auth(request(app).get('/api/v1/access-logs/active'));
    expect(active.body.data.find((l) => l.id === created.body.id).person.name).toBe('Zélia Depois das Cem');

    const detail = await auth(request(app).get(`/api/v1/access-logs/${created.body.id}`));
    expect(detail.body.person.name).toBe('Zélia Depois das Cem');
  });

  test('cadastro removido (soft delete) continua aparecendo no histórico', async () => {
    const person = await createPerson({ companyId: company.id, name: 'Pessoa Removida' });
    const created = await auth(request(app).post('/api/v1/access-logs')).send({ personId: person.id, entryGateId: gate.id });
    await db('people').where({ id: person.id }).update({ deleted_at: db.fn.now() });

    const detail = await auth(request(app).get(`/api/v1/access-logs/${created.body.id}`));
    expect(detail.body.person).toMatchObject({ id: person.id, name: 'Pessoa Removida' });
  });

  test('registro de frota vem com veículo, motorista, guincho e portões', async () => {
    const vehicle = await createVehicle({ companyId: company.id, vehicleType: VEHICLE_TYPE_FLEET, licensePlate: 'FRT2B34' });
    const tow = await createVehicle({ companyId: company.id, vehicleType: VEHICLE_TYPE_FLEET, licensePlate: 'GCH3C45' });
    const driver = await createPerson({ companyId: company.id, name: 'Motorista Teste', personType: PERSON_TYPE_EMPLOYEE });

    const created = await auth(request(app).post('/api/v1/fleet-logs')).send({
      vehicleId: vehicle.id,
      driverId: driver.id,
      transportingVehicleId: tow.id,
      departureGateId: gate.id,
      kmDeparture: 5000,
    });
    expect(created.status).toBe(201);

    const list = await auth(request(app).get('/api/v1/fleet-logs')).query({ limit: 1 });
    expect(list.body.data[0]).toMatchObject({
      id: created.body.id,
      vehicle: { id: vehicle.id, licensePlate: 'FRT2B34', vehicleType: VEHICLE_TYPE_FLEET },
      driver: { id: driver.id, name: 'Motorista Teste' },
      transportingVehicle: { id: tow.id, licensePlate: 'GCH3C45' },
      departureGate: { id: gate.id, name: 'Portaria Norte' },
      returnGate: null,
    });

    const onTrip = await auth(request(app).get('/api/v1/fleet-logs/on-trip'));
    expect(onTrip.body.data.find((l) => l.id === created.body.id).driver.name).toBe('Motorista Teste');

    const detail = await auth(request(app).get(`/api/v1/fleet-logs/${created.body.id}`));
    expect(detail.body.vehicle.licensePlate).toBe('FRT2B34');
  });
});
