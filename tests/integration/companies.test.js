const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { signAccessToken } = require('../../src/utils/jwt');
const { createCompany, createAdminUser, createRegularUser, randomValidCnpj, uniqueSuffix } = require('../helpers/factories');

function tokenFor(user, companyId) {
  return signAccessToken({ userId: user.id, companyId, rules: user.rules, mustChangePassword: false });
}

async function createCity() {
  const suffix = uniqueSuffix();
  const [row] = await db('cities')
    .insert({ name: `Cidade Teste ${suffix}`, state_abbr: 'SP' })
    .returning('*');
  return row;
}

describe('PUT /companies/me', () => {
  let company;
  let admin;
  let operator;
  let adminToken;
  let operatorToken;
  let city;

  beforeAll(async () => {
    company = await createCompany();
    admin = await createAdminUser(company.id);
    operator = await createRegularUser(company.id);
    adminToken = tokenFor(admin, company.id);
    operatorToken = tokenFor(operator, company.id);
    city = await createCity();
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('sem token -> 401', async () => {
    const res = await request(app).put('/api/v1/companies/me').send({ corporateName: 'Nova Razão Social' });
    expect(res.status).toBe(401);
  });

  test('como operador não-admin -> 403', async () => {
    const res = await request(app)
      .put('/api/v1/companies/me')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ corporateName: 'Nova Razão Social' });
    expect(res.status).toBe(403);
  });

  // Corpo da requisição em camelCase (é assim que companies.service.js lê o
  // payload), resposta em snake_case (GET/PUT /companies/me devolvem a linha
  // crua do Knex — mesma assimetria já documentada em
  // frontend/src/features/settings/useSettingsData.js).
  test('como admin -> 200, atualiza todos os campos e traz o nome da cidade via join', async () => {
    const newCnpj = randomValidCnpj();
    const res = await request(app)
      .put('/api/v1/companies/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        corporateName: 'Empresa Atualizada LTDA',
        tradeName: 'Empresa Atualizada',
        cnpj: newCnpj,
        zipCode: '01310100',
        street: 'Av. Paulista',
        addressNumber: '1000',
        complement: 'Sala 10',
        neighborhood: 'Bela Vista',
        cityId: city.id,
        contactEmail: 'contato@empresa-atualizada.com',
        contactPhone: '11987654321',
      });

    expect(res.status).toBe(200);
    expect(res.body.corporate_name).toBe('Empresa Atualizada LTDA');
    expect(res.body.trade_name).toBe('Empresa Atualizada');
    expect(res.body.cnpj).toBe(newCnpj);
    expect(res.body.zip_code).toBe('01310100');
    expect(res.body.street).toBe('Av. Paulista');
    expect(res.body.address_number).toBe('1000');
    expect(res.body.complement).toBe('Sala 10');
    expect(res.body.neighborhood).toBe('Bela Vista');
    expect(res.body.city_id).toBe(city.id);
    expect(res.body.city_name).toBe(city.name);
    // trg_companies_sync_state (create_companies) sobrescreve `state` com o
    // UF da cidade escolhida — confirma que o trigger disparou de verdade.
    expect(res.body.state).toBe('SP');
    expect(res.body.contact_email).toBe('contato@empresa-atualizada.com');
    expect(res.body.contact_phone).toBe('11987654321');
  });

  // Pedido do usuário: edição em Configurações precisa aparecer em
  // Relatórios > Auditoria. trg_audit_companies (migration
  // add_audit_trigger_to_companies) + withAuthTransaction no service são o
  // que fazem isso funcionar — sem qualquer um dos dois, ou não haveria
  // linha nenhuma em audit_logs, ou ela existiria com user_id NULL.
  test('edição fica registrada em audit_logs (Auditoria) com o admin que fez a alteração', async () => {
    const res = await request(app)
      .put('/api/v1/companies/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tradeName: 'Nome Fantasia Para Auditoria' });
    expect(res.status).toBe(200);

    const auditRow = await db('audit_logs')
      .where({ company_id: company.id, table_name: 'companies', record_id: company.id, action: 'UPDATE' })
      .orderBy('changed_at', 'desc')
      .first();

    expect(auditRow).toBeDefined();
    expect(auditRow.user_id).toBe(admin.id);
    expect(auditRow.new_data.trade_name).toBe('Nome Fantasia Para Auditoria');
  });

  test('CNPJ inválido (dígito verificador incorreto) -> 400', async () => {
    const valid = randomValidCnpj();
    // Corrompe o último dígito verificador mantendo 14 dígitos não-todos-iguais.
    const lastDigit = Number(valid[13]);
    const invalid = valid.slice(0, 13) + ((lastDigit + 1) % 10);

    const res = await request(app)
      .put('/api/v1/companies/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cnpj: invalid });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CNPJ inválido');
  });

  test('razão social vazia -> 400', async () => {
    const res = await request(app)
      .put('/api/v1/companies/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ corporateName: '   ' });
    expect(res.status).toBe(400);
  });

  test('sem nenhum campo no corpo -> 400', async () => {
    const res = await request(app).put('/api/v1/companies/me').set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(400);
  });

  // Não há como um admin tentar editar OUTRA empresa por aqui: a rota é fixa
  // em "/me" e o id usado é sempre req.auth.companyId (do JWT, não da URL) —
  // diferente de /people/:id ou /users/:id, não existe parâmetro pra
  // "adivinhar" ou manipular. Isolamento entre tenants é garantido pelo
  // próprio desenho da rota, não por um filtro que pudesse ser esquecido.
});
