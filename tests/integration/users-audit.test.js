const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { signAccessToken } = require('../../src/utils/jwt');
const { createCompany, createAdminUser, createRegularUser } = require('../helpers/factories');
const RULES = require('../../src/config/rules');

// CPF válido (dígitos verificadores) a partir de 9 dígitos quaisquer.
function validCpf(base9) {
  const digits = String(base9).padStart(9, '0').split('').map(Number);
  for (let len = 9; len < 11; len += 1) {
    const sum = digits.reduce((acc, d, i) => acc + d * (len + 1 - i), 0);
    const rest = (sum * 10) % 11;
    digits.push(rest === 10 ? 0 : rest);
  }
  return digits.join('');
}

// Prestação de contas (LGPD): mudanças em operadores ficam na Auditoria,
// com quem fez — e o hash da senha nunca vai pra trilha.
describe('Auditoria de usuários', () => {
  let company;
  let admin;
  let adminToken;

  beforeAll(async () => {
    company = await createCompany();
    admin = await createAdminUser(company.id);
    adminToken = signAccessToken({ userId: admin.id, companyId: company.id, rules: admin.rules, mustChangePassword: false });
  });

  afterAll(async () => {
    await db.destroy();
  });

  const auditOf = (recordId) =>
    db('audit_logs').where({ table_name: 'users', record_id: recordId }).orderBy('id', 'asc');

  test('criar, mudar permissão e remover gera auditoria com o autor e sem password_hash', async () => {
    const created = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Operador Auditado', cpf: validCpf(Date.now() % 1e9), email: `aud${Date.now()}@teste.com`, password: 'SenhaTemp123!' });
    expect(created.status).toBe(201);
    const userId = created.body.id;

    const promoted = await request(app)
      .patch(`/api/v1/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rules: RULES.ADMIN });
    expect(promoted.status).toBe(200);

    const removed = await request(app).delete(`/api/v1/users/${userId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(removed.status).toBe(204);

    const logs = await auditOf(userId);
    expect(logs.map((l) => l.action)).toEqual(['INSERT', 'UPDATE', 'UPDATE']);
    for (const log of logs) {
      expect(log.user_id).toBe(admin.id);
      expect(log.company_id).toBe(company.id);
      expect(log.new_data).not.toHaveProperty('password_hash');
      if (log.old_data) expect(log.old_data).not.toHaveProperty('password_hash');
    }
    expect(logs[0].new_data.name_encrypted).not.toContain('Operador');
    expect(logs[1].old_data.rules).toBe(0);
    expect(logs[1].new_data.rules).toBe(RULES.ADMIN);
    expect(logs[2].new_data.deleted_at).not.toBeNull();
  });

  test('troca de senha do próprio usuário fica registrada sem o hash', async () => {
    const user = await createRegularUser(company.id);
    const token = signAccessToken({ userId: user.id, companyId: company.id, rules: user.rules, mustChangePassword: false });

    const res = await request(app)
      .patch(`/api/v1/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'NovaSenhaForte123!' });
    expect(res.status).toBe(200);

    const [log] = (await auditOf(user.id)).filter((l) => l.action === 'UPDATE');
    expect(log.user_id).toBe(user.id);
    expect(log.old_data).not.toHaveProperty('password_hash');
    expect(log.new_data).not.toHaveProperty('password_hash');
    expect(log.new_data.must_change_password).toBe(false);
  });
});
