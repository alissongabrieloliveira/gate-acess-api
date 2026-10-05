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
  createCity,
  testCityId,
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

    test('troca a pessoa e o veículo por outros cadastros, sem mexer nos cadastros', async () => {
      const log = await createAccess();
      const right = await createPerson({ companyId: company.id, name: 'Pessoa Certa', personType: PERSON_TYPE_EMPLOYEE });
      const rightVehicle = await createVehicle({ companyId: company.id });
      const wrong = await db('people').where({ id: log.personId }).first();

      const res = await put(log.id, { personId: right.id, vehicleId: rightVehicle.id });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ personId: right.id, vehicleId: rightVehicle.id });
      // O cadastro da pessoa indicada errado continua como estava.
      expect((await db('people').where({ id: wrong.id }).first()).name_encrypted).toBe(wrong.name_encrypted);
    });

    test('tirar o veículo limpa o KM; veículo de frota -> 400; personId vazio -> 400', async () => {
      const log = await createAccess();
      const cleared = await put(log.id, { vehicleId: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body).toMatchObject({ vehicleId: null, kmEntry: null, kmExit: null });

      const fleet = await createVehicle({ companyId: company.id, vehicleType: VEHICLE_TYPE_FLEET });
      expect((await put(log.id, { vehicleId: fleet.id })).status).toBe(400);
      expect((await put(log.id, { personId: null })).status).toBe(400);
    });

    test('troca/datas que fazem o período cruzar outro registro da mesma pessoa/veículo -> 409', async () => {
      const log = await createAccess({ finished: false });
      const other = await createAccess({ finished: false });

      // Os dois em aberto: trocar pela pessoa/veículo do outro cruza o período.
      const byPerson = await put(log.id, { personId: other.personId });
      expect(byPerson.status).toBe(409);
      expect(byPerson.body.error).toMatch(/já tem registro nesse período .*ainda dentro/);
      expect((await put(log.id, { vehicleId: other.vehicleId })).status).toBe(409);
      // Reenviar a própria pessoa/veículo não conflita consigo mesmo.
      expect((await put(log.id, { personId: log.personId, vehicleId: log.vehicleId })).status).toBe(200);

      // Registro finalizado ANTES da entrada do outro pode apontar pra ele...
      const finished = await createAccess();
      await db('access_logs')
        .where({ id: finished.id })
        .update({ entry_time: minutesAgo(300), exit_time: minutesAgo(240) });
      expect((await put(finished.id, { vehicleId: other.vehicleId })).status).toBe(200);
      // ...mas não se a saída passar a ser depois da entrada do outro.
      const crossing = await put(finished.id, { exitTime: new Date().toISOString() });
      expect(crossing.status).toBe(409);
      expect(crossing.body.error).toMatch(/Veículo .* já tem registro nesse período/);
    });

    test('pessoa de OUTRA empresa -> 400; operador -> 403', async () => {
      const log = await createAccess();
      const otherCompany = await createCompany();
      const outsider = await createPerson({ companyId: otherCompany.id });
      expect((await put(log.id, { personId: outsider.id })).status).toBe(400);
      const someone = await createPerson({ companyId: company.id });
      expect((await put(log.id, { personId: someone.id }, operatorToken)).status).toBe(403);
    });
  });

  describe('Controle de Frota', () => {
    async function createTrip({ returned = true } = {}) {
      const vehicle = await createVehicle({ companyId: company.id, vehicleType: VEHICLE_TYPE_FLEET });
      const driver = await createPerson({ companyId: company.id, personType: PERSON_TYPE_EMPLOYEE });
      const dep = await request(app)
        .post('/api/v1/fleet-logs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          vehicleId: vehicle.id,
          driverId: driver.id,
          departureGateId: gate.id,
          kmDeparture: 5000,
          destinationCityId: await testCityId(),
        });
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

    test('troca o motorista e o veículo por outros cadastros', async () => {
      const log = await createTrip({ returned: false });
      const rightDriver = await createPerson({ companyId: company.id, personType: PERSON_TYPE_EMPLOYEE });
      const rightVehicle = await createVehicle({ companyId: company.id, vehicleType: VEHICLE_TYPE_FLEET });
      const res = await put(log.id, { driverId: rightDriver.id, vehicleId: rightVehicle.id });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ driverId: rightDriver.id, vehicleId: rightVehicle.id });
    });

    test('troca de veículo: não-frota -> 400; veículo que já está fora -> 409', async () => {
      const log = await createTrip({ returned: false });
      const visitor = await createVehicle({ companyId: company.id });
      expect((await put(log.id, { vehicleId: visitor.id })).status).toBe(400);

      const busy = await createTrip({ returned: false });
      const res = await put(log.id, { vehicleId: busy.vehicleId });
      expect(res.status).toBe(409);
    });

    test('trocar o guincho atualiza o transportado', async () => {
      const tow = await createVehicle({ companyId: company.id, vehicleType: VEHICLE_TYPE_FLEET });
      const carried = await createVehicle({ companyId: company.id, vehicleType: VEHICLE_TYPE_FLEET });
      const newTow = await createVehicle({ companyId: company.id, vehicleType: VEHICLE_TYPE_FLEET });
      const driver = await createPerson({ companyId: company.id, personType: PERSON_TYPE_EMPLOYEE });
      const dep = await request(app)
        .post('/api/v1/fleet-logs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          vehicleId: tow.id,
          driverId: driver.id,
          carriedVehicleId: carried.id,
          departureGateId: gate.id,
          kmDeparture: 10,
          destinationCityId: await testCityId(),
        });
      expect(dep.status).toBe(201);

      expect((await put(dep.body.id, { vehicleId: newTow.id })).status).toBe(200);
      const carriedLog = await db('fleet_logs').where({ transport_log_id: dep.body.id }).first();
      expect(carriedLog.transporting_vehicle_id).toBe(newTow.id);
      // O transportado não pode virar o próprio guincho.
      expect((await put(carriedLog.id, { vehicleId: newTow.id })).status).toBe(400);
    });

    test('corrige KM, destino, motivo e datas', async () => {
      const log = await createTrip();
      const departureTime = minutesAgo(300);
      const returnTime = minutesAgo(100);
      const city = await createCity({ name: 'Anápolis', stateAbbr: 'GO' });

      const res = await put(log.id, {
        kmDeparture: 6000,
        kmReturn: 6150,
        destinationCityId: city.id,
        purpose: 'Entrega',
        departureTime,
        returnTime,
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ kmDeparture: 6000, kmReturn: 6150, destination: 'Anápolis - GO', purpose: 'Entrega' });
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
      const city = await createCity({ name: 'Brasília', stateAbbr: 'DF' });
      expect((await put(log.id, { destinationCityId: city.id })).status).toBe(200);
    });

    test('retorno antes da saída -> 400', async () => {
      const log = await createTrip();
      const res = await put(log.id, { departureTime: minutesAgo(10), returnTime: minutesAgo(20) });
      expect(res.status).toBe(400);
    });

    test('destino em texto livre -> 400; apagar o destino (null) -> 400', async () => {
      const log = await createTrip();
      expect((await put(log.id, { destination: 'Brasília' })).status).toBe(400);
      expect((await put(log.id, { destinationCityId: null })).status).toBe(400);
    });

    test('registro antigo sem destino continua editável nos outros campos', async () => {
      const log = await createTrip();
      await db('fleet_logs').where({ id: log.id }).update({ destination: null });
      const res = await put(log.id, { purpose: 'Correção' });
      expect(res.status).toBe(200);
      expect(res.body.destination).toBeNull();
    });
  });
});
