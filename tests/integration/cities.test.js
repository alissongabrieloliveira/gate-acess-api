const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { signAccessToken } = require('../../src/utils/jwt');
const { createCompany, createAdminUser, createCity } = require('../helpers/factories');

describe('GET /cities — busca', () => {
  let token;

  beforeAll(async () => {
    const company = await createCompany();
    const admin = await createAdminUser(company.id);
    token = signAccessToken({ userId: admin.id, companyId: company.id, rules: admin.rules, mustChangePassword: false });
    await createCity({ name: 'Vila Propício Teste Açaí', stateAbbr: 'GO' });
  });

  afterAll(async () => {
    await db.destroy();
  });

  const search = (term) =>
    request(app).get('/api/v1/cities').query({ search: term }).set('Authorization', `Bearer ${token}`);

  test('ignora acentos e maiúsculas, nos dois sentidos', async () => {
    for (const term of ['propicio teste acai', 'PROPÍCIO TESTE', 'propício teste açaí']) {
      const res = await search(term);
      expect(res.status).toBe(200);
      expect(res.body.data.map((c) => c.name)).toContain('Vila Propício Teste Açaí');
    }
  });

  test('% e _ digitados valem como texto, não curinga', async () => {
    const res = await search('Propício%Açaí');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
