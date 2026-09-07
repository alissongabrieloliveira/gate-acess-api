/**
 * Suporte a senha temporária + troca obrigatória no primeiro login (decisão
 * de segurança: admin não deve conseguir definir/saber a senha de uso
 * contínuo de outro usuário — só a senha inicial, na criação, e mesmo essa
 * precisa ser trocada antes do usuário conseguir usar o sistema).
 *
 * DEFAULT FALSE: usuários já existentes (criados antes desta migration) não
 * são forçados a trocar senha — só afeta usuários criados a partir de agora.
 */
exports.up = async function up(knex) {
  await knex.raw(`ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;`);
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE users DROP COLUMN IF EXISTS must_change_password;`);
};
