/**
 * Logo da empresa (Configurações > Dados da Empresa), impressa no recibo de
 * acesso e nos relatórios em PDF. Guarda o CAMINHO no bucket do Supabase
 * Storage (privado), igual a people/vehicles.photo_url — a API devolve uma
 * URL assinada. Aditiva: código antigo não lê a coluna.
 */
exports.up = async function up(knex) {
  await knex.raw(`ALTER TABLE companies ADD COLUMN logo_url TEXT NULL;`);
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE companies DROP COLUMN logo_url;`);
};
