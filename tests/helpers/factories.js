// Fixtures de teste inseridas direto via Knex, no mesmo formato que os
// repositories reais gravam (campos *_encrypted via encryptField, *_bindex
// via generateBindex, senha via hashPassword) — modelado no seed
// src/db/seeds/001_initial_company_and_admin.js, mas parametrizado (sem ler
// env vars) pra cada teste poder criar exatamente os dados que precisa.
const db = require('./db');
const { encryptField } = require('../../src/utils/crypto');
const { generateBindex } = require('../../src/utils/bindex');
const { hashPassword } = require('../../src/utils/password');
const RULES = require('../../src/config/rules');

let counter = 0;

// Sufixo simples (contador + timestamp + aleatório) pra CPF/e-mail/CNPJ nunca
// colidirem entre testes — sem depender de uma lib de fixtures/faker.
function uniqueSuffix() {
  counter += 1;
  return `${Date.now()}${counter}${Math.floor(Math.random() * 1000)}`;
}

function elevenDigits(suffix) {
  return suffix.slice(-11).padStart(11, '0');
}

function cnpjCheckDigit(digits, weights) {
  const sum = digits.reduce((acc, digit, index) => acc + digit * weights[index], 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

// Mesmo algoritmo (mod-11) da função is_valid_cnpj() do Postgres
// (src/db/migrations/20260903190000_extensions_and_global_functions.js) —
// companies.cnpj tem CHECK (is_valid_cnpj(cnpj)), então um CNPJ qualquer não
// passa no insert.
function randomValidCnpj() {
  let base;
  do {
    base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  } while (base.every((digit) => digit === base[0]));

  const dv1 = cnpjCheckDigit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = cnpjCheckDigit([...base, dv1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...base, dv1, dv2].join('');
}

async function createCompany(overrides = {}) {
  const [row] = await db('companies')
    .insert({
      corporate_name: overrides.corporateName ?? `Empresa Teste ${uniqueSuffix()}`,
      cnpj: overrides.cnpj ?? randomValidCnpj(),
    })
    .returning('*');
  return row;
}

// Retorna a senha em texto puro junto (rawPassword) — o teste precisa dela
// pra logar de verdade via POST /auth/login.
async function createUser({
  companyId,
  name,
  cpf,
  email,
  password,
  rules = 0,
  isActive = true,
  mustChangePassword = false,
} = {}) {
  const suffix = uniqueSuffix();
  const rawPassword = password ?? 'SenhaTeste123!';
  const rawEmail = email ?? `usuario.${suffix}@teste.com`;
  const rawCpf = cpf ?? elevenDigits(suffix);

  const [row] = await db('users')
    .insert({
      company_id: companyId,
      name_encrypted: encryptField(name ?? 'Usuário Teste'),
      cpf_encrypted: encryptField(rawCpf),
      email_encrypted: encryptField(rawEmail),
      cpf_bindex: generateBindex(rawCpf),
      email_bindex: generateBindex(rawEmail),
      password_hash: await hashPassword(rawPassword),
      rules,
      is_active: isActive,
      must_change_password: mustChangePassword,
    })
    .returning('*');

  return { ...row, rawPassword, email: rawEmail, cpf: rawCpf };
}

function createAdminUser(companyId, overrides = {}) {
  return createUser({ companyId, rules: RULES.ADMIN, ...overrides });
}

function createRegularUser(companyId, overrides = {}) {
  return createUser({ companyId, rules: 0, ...overrides });
}

async function createPerson({ companyId, name, cpf, personType = 1, isBlocked = false, blockReason = null } = {}) {
  const rawCpf = cpf ?? elevenDigits(uniqueSuffix());

  const [row] = await db('people')
    .insert({
      company_id: companyId,
      person_type: personType,
      name_encrypted: encryptField(name ?? 'Pessoa Teste'),
      cpf_encrypted: encryptField(rawCpf),
      cpf_bindex: generateBindex(rawCpf),
      is_blocked: isBlocked,
      block_reason: blockReason,
    })
    .returning('*');

  return { ...row, cpf: rawCpf };
}

async function createVehicle({ companyId, licensePlate, brand, model, vehicleType = 1 } = {}) {
  const suffix = uniqueSuffix().slice(-6);
  const [row] = await db('vehicles')
    .insert({
      company_id: companyId,
      vehicle_type: vehicleType,
      license_plate: licensePlate ?? `TST${suffix}`.slice(0, 7).toUpperCase(),
      brand: brand ?? 'Marca Teste',
      model: model ?? 'Modelo Teste',
    })
    .returning('*');
  return row;
}

module.exports = {
  uniqueSuffix,
  randomValidCnpj,
  createCompany,
  createUser,
  createAdminUser,
  createRegularUser,
  createPerson,
  createVehicle,
};
