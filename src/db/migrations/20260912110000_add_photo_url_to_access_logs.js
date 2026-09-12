/**
 * Foto da visita (não da pessoa) — tirada pelo porteiro no momento da
 * entrada, tipicamente do veículo. Mesmo padrão de `people.photo_url`/
 * `vehicles.photo_url` (só o caminho no bucket fica no banco), mas escopada
 * ao access_log em si: cada entrada tem sua própria foto, sem sobrescrever
 * nada de `people`/`vehicles` (que são cadastros reutilizados entre visitas).
 */
exports.up = async function up(knex) {
  await knex.raw(`ALTER TABLE access_logs ADD COLUMN photo_url TEXT NULL;`);
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE access_logs DROP COLUMN IF EXISTS photo_url;`);
};
