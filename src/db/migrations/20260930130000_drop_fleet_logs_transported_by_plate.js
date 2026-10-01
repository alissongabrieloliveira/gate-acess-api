/**
 * Remove fleet_logs.transported_by_plate (placa de guincho de TERCEIRO levando
 * veículo da frota). Esse caso saiu do Controle de Frota na migration
 * 20260930120000 e a coluna deixou de ser gravada; produção conferida vazia
 * pelo usuário antes da remoção. Por segurança, recusa rodar se achar algum
 * valor (não apaga dado sem ninguém ver).
 *
 * Deploy: o código que parou de ler a coluna precisa estar no ar ANTES desta
 * migration — o anterior faz SELECT dela em toda consulta de frota.
 */
exports.up = async function up(knex) {
  const { rows } = await knex.raw(`SELECT count(*)::int AS total FROM fleet_logs WHERE transported_by_plate IS NOT NULL`);
  if (rows[0].total > 0) {
    throw new Error(
      `fleet_logs.transported_by_plate tem ${rows[0].total} registro(s) preenchido(s) — revise antes de remover a coluna.`
    );
  }
  await knex.raw(`ALTER TABLE fleet_logs DROP COLUMN transported_by_plate;`);
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE fleet_logs ADD COLUMN transported_by_plate VARCHAR(10) NULL;`);
};
