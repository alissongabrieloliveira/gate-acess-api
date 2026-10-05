const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { signAccessToken } = require('../../src/utils/jwt');
const { encryptField } = require('../../src/utils/crypto');
const {
  createCompany,
  createAdminUser,
  createRegularUser,
  createPerson,
  createVehicle,
  createGate,
  testCityId,
} = require('../helpers/factories');

const PERSON_TYPE_EMPLOYEE = 3;
const VEHICLE_TYPE_FLEET = 2;

afterAll(async () => {
  await db.destroy();
});

// LGPD art. 18: anonimização a pedido do titular — os registros ficam, o que
// identifica a pessoa sai (inclusive das cópias na trilha de auditoria).
describe('POST /people/:id/anonymize', () => {
  let company;
  let admin;
  let adminToken;
  let operatorToken;
  let gate;

  beforeAll(async () => {
    company = await createCompany();
    admin = await createAdminUser(company.id);
    const operator = await createRegularUser(company.id);
    adminToken = signAccessToken({ userId: admin.id, companyId: company.id, rules: admin.rules, mustChangePassword: false });
    operatorToken = signAccessToken({ userId: operator.id, companyId: company.id, rules: operator.rules, mustChangePassword: false });
    gate = await createGate({ companyId: company.id, name: 'Portaria Anon' });
  });

  const auth = (req, token = adminToken) => req.set('Authorization', `Bearer ${token}`);
  const anonymize = (id, token) => auth(request(app).post(`/api/v1/people/${id}/anonymize`), token);

  async function personWithHistory() {
    const person = await createPerson({ companyId: company.id, name: 'Joana Titular', personType: PERSON_TYPE_EMPLOYEE });
    await auth(request(app).put(`/api/v1/people/${person.id}`)).send({ rg: '1234567', phone: '62988887777' });
    await db('people').where({ id: person.id }).update({ photo_url: `people/${person.id}.jpg` });

    const visitorCar = await createVehicle({ companyId: company.id, licensePlate: `VIS${person.id}`.slice(0, 7) });
    const fleetCar = await createVehicle({ companyId: company.id, vehicleType: VEHICLE_TYPE_FLEET });

    const entry = await auth(request(app).post('/api/v1/access-logs')).send({
      personId: person.id,
      vehicleId: visitorCar.id,
      entryGateId: gate.id,
      kmEntry: 500,
      visitReason: 'Consulta com Dr. Silva',
      observation: 'Veio com a filha Ana',
    });
    expect(entry.status).toBe(201);
    await auth(request(app).patch(`/api/v1/access-logs/${entry.body.id}/exit`)).send({ exitGateId: gate.id, kmExit: 505 });

    // Acesso antigo com veículo da frota (hoje a API recusa; registros antigos existem).
    const [fleetAccess] = await db('access_logs')
      .insert({
        company_id: company.id,
        person_id: person.id,
        vehicle_id: fleetCar.id,
        entry_gate_id: gate.id,
        entry_operator_id: admin.id,
        exit_time: db.fn.now(),
        status: 'FINISHED',
        photo_url: 'access-logs/foto.jpg',
      })
      .returning('id');

    const trip = await auth(request(app).post('/api/v1/fleet-logs')).send({
      destinationCityId: await testCityId(),
      vehicleId: fleetCar.id,
      driverId: person.id,
      departureGateId: gate.id,
      kmDeparture: 1000,
      purpose: 'Banco',
      observation: 'Motorista Joana passou mal',
    });
    expect(trip.status).toBe(201);
    await auth(request(app).patch(`/api/v1/fleet-logs/${trip.body.id}/return`)).send({ returnGateId: gate.id, kmReturn: 1010 });

    const original = await db('people').where({ id: person.id }).first();
    return { person, original, visitorCar, fleetCar, entryId: entry.body.id, fleetAccessId: fleetAccess.id, tripId: trip.body.id };
  }

  test('remove o que identifica e mantém os registros', async () => {
    const h = await personWithHistory();

    const res = await anonymize(h.person.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: h.person.id, accessLogsUpdated: 2, fleetLogsUpdated: 1 });

    const person = await auth(request(app).get(`/api/v1/people/${h.person.id}`));
    expect(person.body).toMatchObject({
      name: `Titular anonimizado #${h.person.id}`,
      cpf: null,
      rg: null,
      phone: null,
      photoUrl: null,
      isAnonymized: true,
    });

    // Acesso com veículo de visitante: registro fica, placa/textos/foto saem.
    const visit = await auth(request(app).get(`/api/v1/access-logs/${h.entryId}`));
    expect(visit.body).toMatchObject({
      personId: h.person.id,
      vehicleId: null,
      kmEntry: 500,
      kmExit: 505,
      visitReason: null,
      observation: null,
      status: 'FINISHED',
      entryGate: { name: 'Portaria Anon' },
    });
    // Acesso com veículo da frota: o veículo (da empresa) continua ligado.
    const fleetAccess = await db('access_logs').where({ id: h.fleetAccessId }).first();
    expect(fleetAccess).toMatchObject({ vehicle_id: h.fleetCar.id, photo_url: null });

    // Frota: tudo fica, menos a observação.
    const trip = await auth(request(app).get(`/api/v1/fleet-logs/${h.tripId}`));
    expect(trip.body).toMatchObject({
      vehicleId: h.fleetCar.id,
      driverId: h.person.id,
      kmDeparture: 1000,
      kmReturn: 1010,
      purpose: 'Banco',
      observation: null,
    });

    // Trilha de auditoria sem nenhuma cópia dos dados antigos.
    const audit = JSON.stringify(
      await db('audit_logs').whereIn('table_name', ['people', 'access_logs', 'fleet_logs']).andWhere((qb) =>
        qb
          .where({ table_name: 'people', record_id: h.person.id })
          .orWhere((q) => q.where({ table_name: 'access_logs' }).whereIn('record_id', [h.entryId, h.fleetAccessId]))
          .orWhere({ table_name: 'fleet_logs', record_id: h.tripId })
      )
    );
    for (const value of [
      h.original.name_encrypted,
      h.original.cpf_encrypted,
      h.original.cpf_bindex,
      h.original.rg_encrypted,
      h.original.phone_encrypted,
      `people/${h.person.id}.jpg`,
      'access-logs/foto.jpg',
    ]) {
      expect(audit).not.toContain(value);
    }
    expect(audit).not.toMatch(new RegExp(`"vehicle_id":\\s*${h.visitorCar.id}\\b`));

    const [record] = await db('audit_logs').where({ table_name: 'people', record_id: h.person.id, action: 'ANONYMIZE' });
    expect(record).toMatchObject({ user_id: admin.id });
  });

  test('justificativa de lançamento retroativo sai, o selo "Retroativo" fica', async () => {
    const person = await createPerson({ companyId: company.id, name: 'Paulo Retro', personType: PERSON_TYPE_EMPLOYEE });
    const fleetCar = await createVehicle({ companyId: company.id, vehicleType: VEHICLE_TYPE_FLEET });
    const hoursAgo = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
    const reason = 'Paulo entrou pelo portão lateral';

    const entry = await auth(request(app).post('/api/v1/access-logs')).send({
      personId: person.id,
      entryGateId: gate.id,
      entryTime: hoursAgo(5),
      exitTime: hoursAgo(4),
      exitGateId: gate.id,
      retroactiveReason: reason,
    });
    expect(entry.status).toBe(201);
    const trip = await auth(request(app).post('/api/v1/fleet-logs')).send({
      destinationCityId: await testCityId(),
      vehicleId: fleetCar.id,
      driverId: person.id,
      departureGateId: gate.id,
      kmDeparture: 100,
      departureTime: hoursAgo(3),
      returnTime: hoursAgo(2),
      returnGateId: gate.id,
      kmReturn: 150,
      retroactiveReason: reason,
    });
    expect(trip.status).toBe(201);

    expect((await anonymize(person.id)).status).toBe(200);

    const access = await auth(request(app).get(`/api/v1/access-logs/${entry.body.id}`));
    expect(access.body).toMatchObject({
      isRetroactive: true,
      entryRetroactiveReason: 'Removido (anonimização LGPD)',
      exitRetroactiveReason: 'Removido (anonimização LGPD)',
    });
    const fleet = await auth(request(app).get(`/api/v1/fleet-logs/${trip.body.id}`));
    expect(fleet.body).toMatchObject({ isRetroactive: true, departureRetroactiveReason: 'Removido (anonimização LGPD)' });

    // Nas cópias da auditoria o texto é zerado.
    const audit = await db('audit_logs').where({ table_name: 'access_logs', record_id: entry.body.id });
    for (const row of audit) {
      expect(row.new_data?.entry_retroactive_reason_encrypted ?? null).toBeNull();
    }
  });

  test('pessoa anonimizada some da lista e da busca e não pode mais ser usada', async () => {
    const h = await personWithHistory();
    expect((await anonymize(h.person.id)).status).toBe(200);

    const list = await auth(request(app).get('/api/v1/people')).query({ limit: 100 });
    expect(list.body.data.map((p) => p.id)).not.toContain(h.person.id);
    const search = await auth(request(app).get('/api/v1/people')).query({ search: h.person.cpf });
    expect(search.body.data).toHaveLength(0);

    expect((await auth(request(app).put(`/api/v1/people/${h.person.id}`)).send({ phone: '62911112222' })).status).toBe(409);
    expect((await auth(request(app).patch(`/api/v1/people/${h.person.id}/block`)).send({ isBlocked: true, reason: 'x' })).status).toBe(409);
    expect((await auth(request(app).post('/api/v1/access-logs')).send({ personId: h.person.id, entryGateId: gate.id })).status).toBe(400);
    expect((await anonymize(h.person.id)).status).toBe(409);
  });

  test('recusa pessoa bloqueada, pessoa dentro da empresa e motorista em viagem', async () => {
    const blocked = await createPerson({ companyId: company.id });
    await db('people').where({ id: blocked.id }).update({ is_blocked: true, block_reason_encrypted: encryptField('Furto') });
    const blockedRes = await anonymize(blocked.id);
    expect(blockedRes.status).toBe(409);
    expect(blockedRes.body.error).toMatch(/bloqueada/i);

    const inside = await createPerson({ companyId: company.id });
    await auth(request(app).post('/api/v1/access-logs')).send({ personId: inside.id, entryGateId: gate.id });
    expect((await anonymize(inside.id)).status).toBe(409);

    const driver = await createPerson({ companyId: company.id, personType: PERSON_TYPE_EMPLOYEE });
    const car = await createVehicle({ companyId: company.id, vehicleType: VEHICLE_TYPE_FLEET });
    await auth(request(app).post('/api/v1/fleet-logs')).send({
      destinationCityId: await testCityId(),
      vehicleId: car.id,
      driverId: driver.id,
      departureGateId: gate.id,
      kmDeparture: 10,
    });
    expect((await anonymize(driver.id)).status).toBe(409);

    // Nada foi alterado nos recusados.
    const untouched = await db('people').where({ id: inside.id }).first();
    expect(untouched.anonymized_at).toBeNull();
    expect(untouched.cpf_bindex).not.toBeNull();
  });

  test('só admin anonimiza; pessoa de outra empresa dá 404', async () => {
    const person = await createPerson({ companyId: company.id });
    expect((await anonymize(person.id, operatorToken)).status).toBe(403);

    const other = await createCompany();
    const stranger = await createPerson({ companyId: other.id });
    expect((await anonymize(stranger.id)).status).toBe(404);
  });
});
