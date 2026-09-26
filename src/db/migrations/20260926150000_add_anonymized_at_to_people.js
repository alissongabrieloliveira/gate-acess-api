/**
 * LGPD art. 18 (anonimização a pedido do titular): marca a pessoa como
 * anonimizada. A linha continua existindo (registros de acesso/frota seguem
 * apontando pra ela), mas sem nada que a identifique — ver
 * modules/anonymization. Pessoa anonimizada sai da listagem e da busca e não
 * pode ser editada nem usada em registros novos.
 */
exports.up = async function up(knex) {
  await knex.raw(`ALTER TABLE people ADD COLUMN anonymized_at TIMESTAMPTZ NULL;`);
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE people DROP COLUMN anonymized_at;`);
};
