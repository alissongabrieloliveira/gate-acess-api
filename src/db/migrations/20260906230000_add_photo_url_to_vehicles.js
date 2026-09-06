/**
 * Foto do veículo (anexada ou tirada na hora pelo operador, ver claude.md
 * seção 8). Mesmo padrão de `people.photo_url` — só a URL fica no banco, o
 * arquivo em si vive em disco (backend/uploads/vehicles), servido como
 * estático. Nunca existiu coluna equivalente em `vehicles` até agora.
 */
exports.up = async function up(knex) {
  await knex.raw(`ALTER TABLE vehicles ADD COLUMN photo_url TEXT NULL;`);
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE vehicles DROP COLUMN IF EXISTS photo_url;`);
};
