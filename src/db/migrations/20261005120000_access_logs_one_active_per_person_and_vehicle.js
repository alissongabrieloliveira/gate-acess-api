/**
 * Controle de Acessos — no máximo UMA entrada em aberto por pessoa e por
 * veículo (antes nada impedia registrar a entrada de alguém, ou de uma placa,
 * que ainda estava dentro).
 *
 * Não envolve fleet_logs: o funcionário que entrou com o carro próprio pode
 * sair num veículo da frota (Controle de Frota) com o acesso ainda em aberto.
 */
async function assertNoDuplicates(knex, column, label) {
  const { rows } = await knex.raw(`
    SELECT company_id, ${column} AS ref, array_agg(id ORDER BY id) AS ids
    FROM access_logs
    WHERE status = 'ACTIVE' AND deleted_at IS NULL AND ${column} IS NOT NULL
    GROUP BY company_id, ${column}
    HAVING count(*) > 1
  `);
  if (rows.length > 0) {
    const detail = rows.map((row) => `${label} ${row.ref}: registros ${row.ids.join(', ')}`).join('; ');
    throw new Error(
      `Há entradas em aberto duplicadas (${detail}). Registre a saída dos registros duplicados ` +
        'antes de rodar esta migration.'
    );
  }
}

exports.up = async function up(knex) {
  await assertNoDuplicates(knex, 'person_id', 'pessoa');
  await assertNoDuplicates(knex, 'vehicle_id', 'veículo');

  await knex.raw(`
    CREATE UNIQUE INDEX idx_access_logs_person_active
      ON access_logs(company_id, person_id) WHERE status = 'ACTIVE' AND deleted_at IS NULL;
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_access_logs_vehicle_active
      ON access_logs(company_id, vehicle_id)
      WHERE status = 'ACTIVE' AND deleted_at IS NULL AND vehicle_id IS NOT NULL;
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_access_logs_vehicle_active;`);
  await knex.raw(`DROP INDEX IF EXISTS idx_access_logs_person_active;`);
};
