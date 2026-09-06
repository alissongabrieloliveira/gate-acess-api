/**
 * Código de identificação livre do veículo (ex.: numeração interna de frota
 * própria — "701", "810" etc.), pensado pra busca rápida na portaria.
 * Diferente da placa: opcional, sem normalização de formato (não é um dado
 * regulado por lei, cada empresa numera do seu jeito). Único por empresa
 * entre veículos "vivos" (mesmo padrão parcial já usado pra license_plate) —
 * Postgres não considera múltiplos NULL como duplicata, então veículos sem
 * identificação (a maioria, visitantes) não são afetados pelo índice.
 */
exports.up = async function up(knex) {
  await knex.raw(`ALTER TABLE vehicles ADD COLUMN identification_code VARCHAR(30) NULL;`);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_vehicles_identification_unique ON vehicles(company_id, identification_code)
        WHERE deleted_at IS NULL;
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_vehicles_identification_unique;`);
  await knex.raw(`ALTER TABLE vehicles DROP COLUMN IF EXISTS identification_code;`);
};
