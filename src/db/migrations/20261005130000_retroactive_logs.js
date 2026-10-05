/**
 * Lançamento retroativo (operador esqueceu de registrar na hora): entrada/
 * saída de acesso e saída/retorno de frota podem ser lançadas com data/hora
 * passada, sempre com justificativa. A justificativa preenchida é o que marca
 * a passagem como retroativa (selo nas telas).
 *
 * - `*_retroactive_reason_encrypted`: texto livre do operador, cifrado como os
 *   demais (ver 20260926130000_encrypt_free_text_fields.js).
 * - `exit_recorded_at` / `return_recorded_at`: quando a saída/retorno foi
 *   lançada de fato (a da entrada/saída da frota é o próprio `created_at`).
 *
 * Só adiciona colunas anuláveis — nada muda para os registros existentes.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE access_logs
      ADD COLUMN entry_retroactive_reason_encrypted TEXT NULL,
      ADD COLUMN exit_retroactive_reason_encrypted TEXT NULL,
      ADD COLUMN exit_recorded_at TIMESTAMPTZ NULL;
  `);
  await knex.raw(`
    ALTER TABLE fleet_logs
      ADD COLUMN departure_retroactive_reason_encrypted TEXT NULL,
      ADD COLUMN return_retroactive_reason_encrypted TEXT NULL,
      ADD COLUMN return_recorded_at TIMESTAMPTZ NULL;
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE fleet_logs
      DROP COLUMN return_recorded_at,
      DROP COLUMN return_retroactive_reason_encrypted,
      DROP COLUMN departure_retroactive_reason_encrypted;
  `);
  await knex.raw(`
    ALTER TABLE access_logs
      DROP COLUMN exit_recorded_at,
      DROP COLUMN exit_retroactive_reason_encrypted,
      DROP COLUMN entry_retroactive_reason_encrypted;
  `);
};
