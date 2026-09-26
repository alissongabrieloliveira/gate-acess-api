/**
 * LGPD (art. 9 e 41): contato do encarregado/canal de privacidade da empresa,
 * impresso no recibo de acesso pra o visitante saber a quem pedir acesso,
 * correção ou exclusão dos próprios dados. Opcional: sem ele, o recibo usa o
 * e-mail/telefone de contato da empresa.
 */
exports.up = async function up(knex) {
  await knex.raw(`ALTER TABLE companies ADD COLUMN privacy_contact VARCHAR(255) NULL;`);
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE companies DROP COLUMN privacy_contact;`);
};
