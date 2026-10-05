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
} = require('../helpers/factories');

const DAY_MS = 24 * 60 * 60 * 1000;

// Antes o Dashboard contava sobre uma amostra de até 100 cadastros/acessos;
// agora os números vêm contados do banco.
describe('GET /dashboard/summary', () => {
  let company;
  let otherCompany;
  let admin;
  let token;
  let gateA;
  let gateB;
  // 01:30 UTC de 2 dias atrás = 22:30 do dia anterior em Brasília (UTC-3).
  let lateEntry;

  beforeAll(async () => {
    company = await createCompany();
    otherCompany = await createCompany();
    admin = await createAdminUser(company.id);
    token = signAccessToken({ userId: admin.id, companyId: company.id, rules: admin.rules, mustChangePassword: false });
    gateA = await createGate({ companyId: company.id, name: 'Portaria A' });
    gateB = await createGate({ companyId: company.id, name: 'Portaria B' });

    // Mais de 100 pessoas, 2 bloqueadas — a amostra antiga não enxergaria a última.
    for (let i = 0; i < 101; i += 1) {
      await createPerson({ companyId: company.id, name: `Pessoa ${i}` });
    }
    const blocked = await createPerson({ companyId: company.id, isBlocked: true, blockReason: 'teste' });
    await createPerson({ companyId: company.id, isBlocked: true, blockReason: 'teste' });
    await createPerson({ companyId: otherCompany.id, isBlocked: true, blockReason: 'outra empresa' });
    // Soft-deletada bloqueada não conta.
    const deleted = await createPerson({ companyId: company.id, isBlocked: true, blockReason: 'removida' });
    await db('people').where({ id: deleted.id }).update({ deleted_at: new Date() });
    // Pessoa antiga (fora da semana) não conta como nova.
    await db('people').where({ id: blocked.id }).update({ created_at: new Date(Date.now() - 20 * DAY_MS) });

    const vehicle = await createVehicle({ companyId: company.id });
    await db('vehicles').where({ id: vehicle.id }).update({ is_blocked: true });

    const person = await createPerson({ companyId: company.id });
    const twoDaysAgo = new Date(Date.now() - 2 * DAY_MS);
    lateEntry = new Date(Date.UTC(twoDaysAgo.getUTCFullYear(), twoDaysAgo.getUTCMonth(), twoDaysAgo.getUTCDate(), 1, 30));
    const base = { company_id: company.id, person_id: person.id, entry_operator_id: admin.id };
    // A mesma pessoa só pode ter UMA entrada em aberto: as anteriores já têm saída.
    const finished = (entryTime) => ({ status: 'FINISHED', entry_time: entryTime, exit_time: entryTime });
    await db('access_logs').insert([
      { ...base, entry_gate_id: gateA.id, ...finished(lateEntry) },
      { ...base, entry_gate_id: gateA.id, ...finished(new Date()) },
      { ...base, entry_gate_id: gateB.id, entry_time: new Date() },
      // Fora do período e soft-deletado: não contam.
      { ...base, entry_gate_id: gateA.id, ...finished(new Date(Date.now() - 20 * DAY_MS)) },
      { ...base, entry_gate_id: gateA.id, entry_time: new Date(), deleted_at: new Date() },
    ]);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const summary = (query) =>
    request(app).get('/api/v1/dashboard/summary').set('Authorization', `Bearer ${token}`).query(query);

  const weekStart = () => new Date(Date.now() - 6 * DAY_MS).toISOString();

  test('conta bloqueados e novos cadastros no banco inteiro da empresa', async () => {
    const res = await summary({ from: weekStart(), timeZone: 'America/Sao_Paulo' });
    expect(res.status).toBe(200);
    expect(res.body.blockedPeople).toBe(2);
    expect(res.body.blockedVehicles).toBe(1);
    // 101 + 1 bloqueada nova + pessoa dos acessos (a outra bloqueada ficou antiga, a removida não conta).
    expect(res.body.newPeople).toBe(103);
  });

  test('acessos por dia e posto, agrupados no fuso pedido', async () => {
    const toDay = (date, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
    const today = toDay(new Date(), 'America/Sao_Paulo');

    const sp = await summary({ from: weekStart(), timeZone: 'America/Sao_Paulo' });
    expect(sp.status).toBe(200);
    const total = sp.body.accessesByDay.reduce((sum, row) => sum + row.count, 0);
    expect(total).toBe(3);
    expect(sp.body.accessesByDay).toEqual(
      expect.arrayContaining([
        { date: toDay(lateEntry, 'America/Sao_Paulo'), gateId: gateA.id, count: 1 },
        { date: today, gateId: gateB.id, count: 1 },
      ])
    );

    const utc = await summary({ from: weekStart(), timeZone: 'UTC' });
    expect(utc.body.accessesByDay).toEqual(
      expect.arrayContaining([{ date: toDay(lateEntry, 'UTC'), gateId: gateA.id, count: 1 }])
    );
    expect(toDay(lateEntry, 'UTC')).not.toBe(toDay(lateEntry, 'America/Sao_Paulo'));
  });

  test('valida from e timeZone', async () => {
    expect((await summary({ timeZone: 'UTC' })).status).toBe(400);
    expect((await summary({ from: 'ontem' })).status).toBe(400);
    expect((await summary({ from: new Date(Date.now() - 60 * DAY_MS).toISOString() })).status).toBe(400);
    expect((await summary({ from: weekStart(), timeZone: 'Marte/Olympus' })).status).toBe(400);
  });

  test('exige autenticação', async () => {
    const res = await request(app).get('/api/v1/dashboard/summary').query({ from: weekStart() });
    expect(res.status).toBe(401);
  });

  test('GET /access-logs filtra por posto de entrada', async () => {
    const res = await request(app)
      .get('/api/v1/access-logs')
      .set('Authorization', `Bearer ${token}`)
      .query({ entryGateId: gateB.id });
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].entryGateId).toBe(gateB.id);

    const invalid = await request(app)
      .get('/api/v1/access-logs')
      .set('Authorization', `Bearer ${token}`)
      .query({ entryGateId: 'abc' });
    expect(invalid.status).toBe(400);
  });
});
