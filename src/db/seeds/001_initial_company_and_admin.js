const RULES = require('../../config/rules');
const { generateBindex } = require('../../utils/bindex');
const { hashPassword } = require('../../utils/password');
const { encryptField } = require('../../utils/crypto');

/**
 * Cria a primeira empresa (tenant) e o primeiro usuário administrador, a partir de
 * dados lidos do .env (nunca hardcoded aqui — ver SEED_* em .env.example). Sem isso,
 * não há como fazer login pela primeira vez em um banco novo, já que o módulo auth
 * só cobre login/refresh/logout.
 *
 * Idempotente de propósito: diferente do padrão comum de seed (del + insert em toda
 * execução), este seed reaproveita a empresa/usuário se já existirem (por CNPJ e por
 * email_bindex), então rodar `npm run seed` de novo não duplica nem apaga dados reais.
 */
function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Seed abortado: variável de ambiente obrigatória ausente: ${name}. ` +
        'Configure os dados da empresa/administrador inicial no .env (ver .env.example) ' +
        'antes de rodar "npm run seed".'
    );
  }
  return value;
}

exports.seed = async function seed(knex) {
  const corporateName = requiredEnv('SEED_COMPANY_CORPORATE_NAME');
  const cnpj = requiredEnv('SEED_COMPANY_CNPJ');
  const adminName = requiredEnv('SEED_ADMIN_NAME');
  const adminCpf = requiredEnv('SEED_ADMIN_CPF');
  const adminEmail = requiredEnv('SEED_ADMIN_EMAIL');
  const adminPassword = requiredEnv('SEED_ADMIN_PASSWORD');
  const adminRules = process.env.SEED_ADMIN_RULES ? Number(process.env.SEED_ADMIN_RULES) : RULES.ADMIN;

  const cleanCnpj = cnpj.replace(/[^0-9]/g, '');
  const emailBindex = generateBindex(adminEmail);
  const cpfBindex = generateBindex(adminCpf);

  await knex.transaction(async (trx) => {
    let company = await trx('companies').where({ cnpj: cleanCnpj }).first();

    if (!company) {
      const [inserted] = await trx('companies')
        .insert({ corporate_name: corporateName, cnpj })
        .returning(['id', 'corporate_name']);
      company = inserted;
      console.log(`[seed] Empresa criada: "${company.corporate_name}" (id=${company.id})`);
    } else {
      console.log(`[seed] Empresa já existia (id=${company.id}) — reaproveitada`);
    }

    const existingUser = await trx('users').where({ email_bindex: emailBindex }).first();

    if (existingUser) {
      console.log(`[seed] Usuário administrador já existia (id=${existingUser.id}) — nada a fazer`);
      return;
    }

    const passwordHash = await hashPassword(adminPassword);

    const [user] = await trx('users')
      .insert({
        company_id: company.id,
        name_encrypted: encryptField(adminName),
        cpf_encrypted: encryptField(adminCpf),
        email_encrypted: encryptField(adminEmail),
        cpf_bindex: cpfBindex,
        email_bindex: emailBindex,
        password_hash: passwordHash,
        rules: adminRules,
      })
      .returning(['id']);

    console.log(`[seed] Usuário administrador criado: id=${user.id} (empresa id=${company.id})`);
  });
};
