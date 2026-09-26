/**
 * LGPD (art. 9 e 46): aviso de privacidade e termo de responsabilidade dos
 * operadores. Guarda QUAL versão do aviso o usuário leu e quando — se o texto
 * mudar (config/privacyNotice.js), o aviso volta a aparecer pra todos. A
 * ciência fica também na Auditoria (trg_audit_users).
 */
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE users
      ADD COLUMN privacy_notice_version VARCHAR(20) NULL,
      ADD COLUMN privacy_notice_accepted_at TIMESTAMPTZ NULL;
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE users
      DROP COLUMN privacy_notice_version,
      DROP COLUMN privacy_notice_accepted_at;
  `);
};
