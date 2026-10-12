jest.mock('../../src/utils/supabaseStorage', () => ({
  uploadPhoto: jest.fn().mockResolvedValue(undefined),
  deletePhoto: jest.fn().mockResolvedValue(undefined),
  getSignedUrls: jest.fn(async (paths) => new Map(paths.map((p) => [p, `https://storage.test/signed/${p}`]))),
  attachSignedPhotoUrls: jest.fn(async (dtos) => dtos),
}));

const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const storage = require('../../src/utils/supabaseStorage');
const { signAccessToken } = require('../../src/utils/jwt');
const { createCompany, createAdminUser, createRegularUser } = require('../helpers/factories');

function tokenFor(user, companyId) {
  return signAccessToken({ userId: user.id, companyId, rules: user.rules, mustChangePassword: false });
}

// PNG 1x1 válido.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

describe('logo da empresa (/companies/me/logo)', () => {
  let company;
  let otherCompany;
  let adminToken;
  let operatorToken;

  beforeAll(async () => {
    company = await createCompany();
    otherCompany = await createCompany();
    adminToken = tokenFor(await createAdminUser(company.id), company.id);
    operatorToken = tokenFor(await createRegularUser(company.id), company.id);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await db.destroy();
  });

  const upload = (token, file = PNG, filename = 'logo.png') =>
    request(app).post('/api/v1/companies/me/logo').set('Authorization', `Bearer ${token}`).attach('logo', file, filename);

  test('admin envia a logo: grava o caminho e devolve URL assinada', async () => {
    const res = await upload(adminToken);
    expect(res.status).toBe(200);

    const [path] = storage.uploadPhoto.mock.calls[0];
    expect(path).toMatch(new RegExp(`^companies/logo-${company.id}-\\d+\\.png$`));
    expect(res.body.logo_url).toBe(`https://storage.test/signed/${path}`);

    const row = await db('companies').where({ id: company.id }).first();
    expect(row.logo_url).toBe(path);
    // Outra empresa não muda.
    expect((await db('companies').where({ id: otherCompany.id }).first()).logo_url).toBeNull();

    const me = await request(app).get('/api/v1/companies/me').set('Authorization', `Bearer ${operatorToken}`);
    expect(me.body.logo_url).toBe(`https://storage.test/signed/${path}`);
  });

  test('trocar a logo apaga a antiga do Storage', async () => {
    const { logo_url: oldPath } = await db('companies').where({ id: company.id }).first();
    const res = await upload(adminToken);
    expect(res.status).toBe(200);
    expect(storage.deletePhoto).toHaveBeenCalledWith(oldPath);
  });

  test('remover a logo limpa a coluna e apaga o arquivo', async () => {
    const { logo_url: oldPath } = await db('companies').where({ id: company.id }).first();
    const res = await request(app).delete('/api/v1/companies/me/logo').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.logo_url).toBeNull();
    expect((await db('companies').where({ id: company.id }).first()).logo_url).toBeNull();
    expect(storage.deletePhoto).toHaveBeenCalledWith(oldPath);
  });

  test('operador não envia nem remove logo (403)', async () => {
    expect((await upload(operatorToken)).status).toBe(403);
    const res = await request(app).delete('/api/v1/companies/me/logo').set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(403);
    expect(storage.uploadPhoto).not.toHaveBeenCalled();
  });

  test('arquivo que não é imagem -> 400; sem arquivo -> 400', async () => {
    const pdf = await upload(adminToken, Buffer.from('%PDF-1.4'), 'logo.pdf');
    expect(pdf.status).toBe(400);
    const none = await request(app).post('/api/v1/companies/me/logo').set('Authorization', `Bearer ${adminToken}`);
    expect(none.status).toBe(400);
    expect(none.body.error).toBe('Nenhuma imagem enviada');
    expect(storage.uploadPhoto).not.toHaveBeenCalled();
  });

  test('imagem acima de 2MB -> 400 com o limite da logo', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 1, 0);
    const res = await upload(adminToken, big, 'grande.png');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('A imagem deve ter no máximo 2MB.');
  });

  test('PUT /companies/me não aceita trocar a logo pelo corpo', async () => {
    const res = await request(app)
      .put('/api/v1/companies/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ logoUrl: 'qualquer/coisa.png', logo_url: 'qualquer/coisa.png' });
    expect(res.status).toBe(400);
    expect((await db('companies').where({ id: company.id }).first()).logo_url).toBeNull();
  });
});
