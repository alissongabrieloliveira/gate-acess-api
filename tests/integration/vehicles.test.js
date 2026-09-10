const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { signAccessToken } = require('../../src/utils/jwt');
const { createCompany, createAdminUser, createVehicle } = require('../helpers/factories');

describe('Veículos (vehicles) — CRUD, normalização de placa, tipo e bloqueio', () => {
  let company;
  let token;

  beforeAll(async () => {
    company = await createCompany();
    const admin = await createAdminUser(company.id);
    token = signAccessToken({ userId: admin.id, companyId: company.id, rules: admin.rules, mustChangePassword: false });
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('POST /vehicles sem placa -> 400', async () => {
    const res = await request(app).post('/api/v1/vehicles').set('Authorization', `Bearer ${token}`).send({ brand: 'Fiat' });
    expect(res.status).toBe(400);
  });

  // normalizePlate() remove qualquer caractere não-alfanumérico e maiuscula —
  // sem isso "ABC-1234" e "ABC1234" seriam tratadas como placas diferentes.
  test('POST /vehicles normaliza a placa (maiúsculas, sem traço) antes de gravar', async () => {
    const res = await request(app)
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send({ licensePlate: 'abc-1a23', brand: 'Fiat', model: 'Uno' });

    expect(res.status).toBe(201);
    expect(res.body.licensePlate).toBe('ABC1A23');

    const row = await db('vehicles').where({ id: res.body.id }).first();
    expect(row.license_plate).toBe('ABC1A23');
  });

  test('POST /vehicles nasce com vehicleType=1 (Visitante) por padrão', async () => {
    const res = await request(app)
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send({ licensePlate: 'DEF4567' });
    expect(res.status).toBe(201);
    expect(res.body.vehicleType).toBe(1);
  });

  test('POST /vehicles com vehicleType inválido -> 400', async () => {
    const res = await request(app)
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send({ licensePlate: 'GHI7890', vehicleType: 99 });
    expect(res.status).toBe(400);
  });

  test('placa duplicada na mesma empresa -> 409 com mensagem específica de placa', async () => {
    await createVehicle({ companyId: company.id, licensePlate: 'DUP0001' });
    const res = await request(app)
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send({ licensePlate: 'dup-0001' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/placa/i);
  });

  test('código de identificação duplicado -> 409 com mensagem específica de identificação (não confunde com placa)', async () => {
    await request(app)
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send({ licensePlate: 'IDT0001', identificationCode: '701' });

    const res = await request(app)
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send({ licensePlate: 'IDT0002', identificationCode: '701' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/identificação/i);
  });

  test('GET /vehicles?plate= faz lookup exato normalizando o termo buscado', async () => {
    const vehicle = await createVehicle({ companyId: company.id, licensePlate: 'LKP1234' });
    const res = await request(app)
      .get('/api/v1/vehicles')
      .query({ plate: 'lkp-1234' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(vehicle.id);
  });

  test('GET /vehicles?identification= faz lookup exato', async () => {
    await request(app)
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send({ licensePlate: 'IDT0003', identificationCode: '810' });
    const res = await request(app)
      .get('/api/v1/vehicles')
      .query({ identification: '810' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].identificationCode).toBe('810');
  });

  test('GET /vehicles?vehicleType= filtra pelo tipo; valor inválido -> 400', async () => {
    await createVehicle({ companyId: company.id, vehicleType: 2, licensePlate: 'FRT0001' });

    const ok = await request(app)
      .get('/api/v1/vehicles')
      .query({ vehicleType: 2 })
      .set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.every((v) => v.vehicleType === 2)).toBe(true);

    const invalid = await request(app)
      .get('/api/v1/vehicles')
      .query({ vehicleType: 99 })
      .set('Authorization', `Bearer ${token}`);
    expect(invalid.status).toBe(400);
  });

  test('GET /vehicles?search= encontra por identificação, placa ou marca/modelo', async () => {
    const vehicle = await createVehicle({ companyId: company.id, licensePlate: 'SRC9999', brand: 'Chevrolet', model: 'Onix Turbo Buscavel' });
    const res = await request(app)
      .get('/api/v1/vehicles')
      .query({ search: 'Turbo Buscavel' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((v) => v.id)).toContain(vehicle.id);
  });

  test('PUT /vehicles/:id sem nenhum campo -> 400', async () => {
    const vehicle = await createVehicle({ companyId: company.id });
    const res = await request(app).put(`/api/v1/vehicles/${vehicle.id}`).set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  test('PUT /vehicles/:id atualiza e renormaliza a placa', async () => {
    const vehicle = await createVehicle({ companyId: company.id });
    const res = await request(app)
      .put(`/api/v1/vehicles/${vehicle.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ licensePlate: 'new-9876', color: 'Prata' });
    expect(res.status).toBe(200);
    expect(res.body.licensePlate).toBe('NEW9876');
    expect(res.body.color).toBe('Prata');
  });

  test('PUT /vehicles/:id com vehicleType inválido -> 400', async () => {
    const vehicle = await createVehicle({ companyId: company.id });
    const res = await request(app)
      .put(`/api/v1/vehicles/${vehicle.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleType: 0 });
    expect(res.status).toBe(400);
  });

  test('PUT /vehicles/:id inexistente -> 404', async () => {
    const res = await request(app)
      .put('/api/v1/vehicles/999999')
      .set('Authorization', `Bearer ${token}`)
      .send({ color: 'Preto' });
    expect(res.status).toBe(404);
  });

  test('PATCH /vehicles/:id/block bloqueia (exige motivo) e desbloqueia (limpa motivo)', async () => {
    const vehicle = await createVehicle({ companyId: company.id });

    const withoutReason = await request(app)
      .patch(`/api/v1/vehicles/${vehicle.id}/block`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isBlocked: true });
    expect(withoutReason.status).toBe(400);

    const blocked = await request(app)
      .patch(`/api/v1/vehicles/${vehicle.id}/block`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isBlocked: true, reason: 'Suspeita de furto' });
    expect(blocked.status).toBe(200);
    expect(blocked.body.isBlocked).toBe(true);
    expect(blocked.body.blockReason).toBe('Suspeita de furto');

    const unblocked = await request(app)
      .patch(`/api/v1/vehicles/${vehicle.id}/block`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isBlocked: false });
    expect(unblocked.status).toBe(200);
    expect(unblocked.body.isBlocked).toBe(false);
    expect(unblocked.body.blockReason).toBeNull();
  });
});
