// Módulo de referência/template — mesmo padrão pra ser repetido depois em
// vehicles/gates/access-logs/fleet-logs (fora do escopo desta primeira leva).
const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { signAccessToken } = require('../../src/utils/jwt');
const { createCompany, createAdminUser, createPerson } = require('../helpers/factories');

describe('Pessoas (people) — CRUD, busca e bloqueio', () => {
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

  test('POST /people cria uma pessoa com os campos sensíveis criptografados no banco', async () => {
    const res = await request(app)
      .post('/api/v1/people')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Fulano de Tal', cpf: '11122233344', personType: 1 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Fulano de Tal');
    expect(res.body.cpf).toBe('11122233344');

    const row = await db('people').where({ id: res.body.id }).first();
    expect(row.name_encrypted).not.toContain('Fulano');
    expect(row.cpf_encrypted).not.toContain('11122233344');
  });

  test('POST /people sem nome -> 400', async () => {
    const res = await request(app).post('/api/v1/people').set('Authorization', `Bearer ${token}`).send({ cpf: '99988877766' });
    expect(res.status).toBe(400);
  });

  describe('busca (?search=)', () => {
    let searchable;

    beforeAll(async () => {
      searchable = await createPerson({ companyId: company.id, name: 'Zebedeu Ferramenta Rara', cpf: '55566677788' });
    });

    test('encontra por substring do nome (case-insensitive)', async () => {
      const res = await request(app).get('/api/v1/people').query({ search: 'ferramenta rara' }).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.map((p) => p.id)).toContain(searchable.id);
    });

    test('encontra por dígitos do CPF', async () => {
      const res = await request(app).get('/api/v1/people').query({ search: '555.666.777-88' }).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.map((p) => p.id)).toContain(searchable.id);
    });

    // Regressão: este projeto já teve um bug real em que um termo de busca
    // sem nenhum dígito (digitsTerm vazio) acabava batendo com TODOS os
    // registros, porque a comparação de CPF/telefone não tinha guarda contra
    // string vazia (`''.includes('')` é sempre true). O guard atual em
    // matchesSearch() (`if (!digitsTerm) return false`) corrige isso — este
    // teste garante que não volta a quebrar.
    test('termo sem dígitos e sem correspondência de nome não bate com todo mundo', async () => {
      const res = await request(app)
        .get('/api/v1/people')
        .query({ search: 'zzz-termo-que-nao-bate-com-ninguem-zzz' })
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });
  });

  test('PATCH /people/:id/block bloqueia e depois desbloqueia', async () => {
    const person = await createPerson({ companyId: company.id, name: 'Pessoa Pra Bloquear' });

    const blockRes = await request(app)
      .patch(`/api/v1/people/${person.id}/block`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isBlocked: true, reason: 'Motivo de teste' });
    expect(blockRes.status).toBe(200);
    expect(blockRes.body.isBlocked).toBe(true);
    expect(blockRes.body.blockReason).toBe('Motivo de teste');

    const unblockRes = await request(app)
      .patch(`/api/v1/people/${person.id}/block`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isBlocked: false });
    expect(unblockRes.status).toBe(200);
    expect(unblockRes.body.isBlocked).toBe(false);
  });

  test('bloquear sem informar o motivo -> 400', async () => {
    const person = await createPerson({ companyId: company.id });
    const res = await request(app)
      .patch(`/api/v1/people/${person.id}/block`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isBlocked: true });
    expect(res.status).toBe(400);
  });

  test('paginação respeita limit/page e o total bate com a contagem real', async () => {
    const namePrefix = `Paginacao ${Date.now()}`;
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => createPerson({ companyId: company.id, name: `${namePrefix} ${i}` }))
    );

    const res = await request(app)
      .get('/api/v1/people')
      .query({ search: namePrefix, limit: 2, page: 2 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toMatchObject({ page: 2, limit: 2, total: 5 });
  });
});
