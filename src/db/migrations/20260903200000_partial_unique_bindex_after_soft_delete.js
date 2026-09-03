/**
 * users.email_bindex, users.cpf_bindex e people.(company_id, cpf_bindex) usavam
 * UNIQUE não-parcial: um registro soft-deletado (deleted_at preenchido) bloqueava o
 * e-mail/CPF para sempre, mesmo a política do projeto sendo soft delete. Mesmo padrão
 * de bug já corrigido para vehicles.license_plate (idx_vehicles_plate_unique) — troca
 * o UNIQUE simples por um índice único PARCIAL, restrito a registros "vivos".
 */
exports.up = async function up(knex) {
  await knex.raw(`ALTER TABLE users DROP CONSTRAINT users_email_bindex_key;`);
  await knex.raw(`ALTER TABLE users DROP CONSTRAINT users_cpf_bindex_key;`);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_users_email_bindex_unique ON users(email_bindex) WHERE deleted_at IS NULL;
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_users_cpf_bindex_unique ON users(cpf_bindex) WHERE deleted_at IS NULL;
  `);

  await knex.raw(`ALTER TABLE people DROP CONSTRAINT people_company_id_cpf_bindex_key;`);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_people_company_cpf_bindex_unique ON people(company_id, cpf_bindex) WHERE deleted_at IS NULL;
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_people_company_cpf_bindex_unique;`);
  await knex.raw(`ALTER TABLE people ADD CONSTRAINT people_company_id_cpf_bindex_key UNIQUE (company_id, cpf_bindex);`);

  await knex.raw(`DROP INDEX IF EXISTS idx_users_cpf_bindex_unique;`);
  await knex.raw(`DROP INDEX IF EXISTS idx_users_email_bindex_unique;`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_cpf_bindex_key UNIQUE (cpf_bindex);`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_email_bindex_key UNIQUE (email_bindex);`);
};
