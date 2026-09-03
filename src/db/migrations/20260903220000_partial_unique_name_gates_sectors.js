/**
 * Mesmo padrão de bug já corrigido para vehicles.license_plate e para
 * users.email_bindex/cpf_bindex/people.cpf_bindex: gates e sectors usam
 * UNIQUE(company_id, name) não-parcial, então um portão/setor soft-deletado
 * bloqueia aquele nome para sempre. Troca por índice único parcial
 * (WHERE deleted_at IS NULL) antes mesmo de existir um módulo de API para essas
 * tabelas, já que o problema é conhecido e o custo de corrigir agora é o mesmo.
 */
exports.up = async function up(knex) {
  await knex.raw(`ALTER TABLE gates DROP CONSTRAINT gates_company_id_name_key;`);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_gates_company_name_unique ON gates(company_id, name) WHERE deleted_at IS NULL;
  `);

  await knex.raw(`ALTER TABLE sectors DROP CONSTRAINT sectors_company_id_name_key;`);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_sectors_company_name_unique ON sectors(company_id, name) WHERE deleted_at IS NULL;
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_sectors_company_name_unique;`);
  await knex.raw(`ALTER TABLE sectors ADD CONSTRAINT sectors_company_id_name_key UNIQUE (company_id, name);`);

  await knex.raw(`DROP INDEX IF EXISTS idx_gates_company_name_unique;`);
  await knex.raw(`ALTER TABLE gates ADD CONSTRAINT gates_company_id_name_key UNIQUE (company_id, name);`);
};
