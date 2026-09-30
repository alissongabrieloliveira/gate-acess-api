/**
 * Controle de Frota — guincho da própria frota e veículo que não retorna.
 *
 * Modelo novo: o veículo principal de um fleet_log é sempre o da frota que
 * sai RODANDO (com motorista). Quando ele é um guincho levando outro veículo:
 * - veículo da frota em cima: ganha um fleet_log próprio (sem motorista),
 *   ligado ao do guincho por `transport_log_id` (+ `transporting_vehicle_id`
 *   = o guincho), que fica "na rua" até voltar — em outro momento, rodando;
 * - veículo de terceiro em cima: só a placa, em `carried_vehicle_plate` no
 *   log do guincho.
 * `transported_by_plate` (guincho de terceiro) deixa de ser gravado — esse
 * caso saiu do Controle de Frota —, mas a coluna fica pelo histórico.
 *
 * Veículo vendido/transferido: o log já nasce `NO_RETURN` com o motivo
 * (previsto no gate_schema.sql, nunca implementado) e o cadastro do veículo
 * recebe o mesmo valor em `vehicles.operation_status`.
 *
 * Também passa a existir no máximo UMA saída em aberto por veículo (antes
 * nada impedia registrar a saída de um veículo que já estava na rua).
 */
exports.up = async function up(knex) {
  const { rows: duplicated } = await knex.raw(`
    SELECT vehicle_id, array_agg(id ORDER BY id) AS ids
    FROM fleet_logs
    WHERE status = 'ON_TRIP' AND deleted_at IS NULL
    GROUP BY vehicle_id
    HAVING count(*) > 1
  `);
  if (duplicated.length > 0) {
    const detail = duplicated.map((row) => `veículo ${row.vehicle_id}: registros ${row.ids.join(', ')}`).join('; ');
    throw new Error(
      `Há veículos com mais de uma saída em aberto (${detail}). Registre o retorno dos registros ` +
        'duplicados antes de rodar esta migration.'
    );
  }

  await knex.raw(`
    ALTER TABLE fleet_logs
      ADD COLUMN transport_log_id INT NULL REFERENCES fleet_logs(id) ON DELETE RESTRICT,
      ADD COLUMN carried_vehicle_plate VARCHAR(10) NULL,
      ADD COLUMN no_return_reason VARCHAR(30) NULL,
      ADD CONSTRAINT chk_fleet_no_return_reason CHECK (
        no_return_reason IS NULL OR no_return_reason IN ('SOLD', 'TRANSFERRED_BRANCH', 'TRANSFERRED_HQ')
      ),
      ADD CONSTRAINT chk_fleet_no_return_status CHECK ((status = 'NO_RETURN') = (no_return_reason IS NOT NULL)),
      ADD CONSTRAINT chk_fleet_not_self_carried CHECK (transport_log_id IS NULL OR transport_log_id <> id);
  `);
  await knex.raw(`CREATE INDEX idx_fleet_logs_transport_log_id ON fleet_logs(transport_log_id);`);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_fleet_logs_vehicle_on_trip
      ON fleet_logs(vehicle_id) WHERE status = 'ON_TRIP' AND deleted_at IS NULL;
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_fleet_logs_vehicle_on_trip;`);
  await knex.raw(`DROP INDEX IF EXISTS idx_fleet_logs_transport_log_id;`);
  await knex.raw(`
    ALTER TABLE fleet_logs
      DROP CONSTRAINT chk_fleet_not_self_carried,
      DROP CONSTRAINT chk_fleet_no_return_status,
      DROP CONSTRAINT chk_fleet_no_return_reason,
      DROP COLUMN no_return_reason,
      DROP COLUMN carried_vehicle_plate,
      DROP COLUMN transport_log_id;
  `);
};
