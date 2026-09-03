/**
 * Saída/retorno de veículos da própria frota (de dentro para fora). Preparada para
 * caminhão prancha/guincho e veículos sem motorista (carga).
 *
 * transporting_vehicle_id referencia vehicles(id) quando o guincho é um veículo
 * cadastrado na própria frota (mantém integridade referencial); transported_by_plate
 * fica só como fallback para guincho de terceiro não cadastrado.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE fleet_logs (
        id SERIAL PRIMARY KEY,
        company_id INT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        vehicle_id INT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,

        driver_id INT NULL REFERENCES people(id) ON DELETE RESTRICT,
        transporting_vehicle_id INT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
        transported_by_plate VARCHAR(10) NULL,
        destination VARCHAR(255) NULL,
        purpose VARCHAR(255) NULL,

        departure_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        departure_gate_id INT NOT NULL REFERENCES gates(id) ON DELETE RESTRICT,
        departure_operator_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

        return_time TIMESTAMPTZ NULL,
        return_gate_id INT NULL REFERENCES gates(id) ON DELETE RESTRICT,
        return_operator_id INT NULL REFERENCES users(id) ON DELETE RESTRICT,

        is_km_unavailable BOOLEAN DEFAULT FALSE,
        km_departure INT NULL,
        km_return INT NULL,
        fuel_level_departure INT NULL,
        fuel_level_return INT NULL,

        status VARCHAR(20) NOT NULL DEFAULT 'ON_TRIP',
        observation TEXT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMPTZ NULL,

        CONSTRAINT chk_return_after_departure CHECK (return_time IS NULL OR return_time >= departure_time),
        CONSTRAINT chk_fleet_km_logic CHECK (km_return IS NULL OR km_departure IS NULL OR km_return >= km_departure),
        CONSTRAINT chk_fleet_km_non_negative CHECK (
            (km_departure IS NULL OR km_departure >= 0) AND (km_return IS NULL OR km_return >= 0)
        ),
        CONSTRAINT chk_fuel_level CHECK (
            (fuel_level_departure IS NULL OR (fuel_level_departure >= 0 AND fuel_level_departure <= 100)) AND
            (fuel_level_return IS NULL OR (fuel_level_return >= 0 AND fuel_level_return <= 100))
        ),
        CONSTRAINT chk_fleet_not_self_transported CHECK (transporting_vehicle_id IS NULL OR transporting_vehicle_id != vehicle_id)
    );
  `);

  await knex.raw(`CREATE INDEX idx_fleet_logs_company_id ON fleet_logs(company_id);`);
  await knex.raw(`CREATE INDEX idx_fleet_logs_status ON fleet_logs(status);`);
  await knex.raw(`
    CREATE INDEX idx_fleet_logs_on_trip ON fleet_logs(company_id) WHERE status = 'ON_TRIP';
  `);

  await knex.raw(`
    CREATE TRIGGER trg_fleet_logs_updated_at BEFORE UPDATE ON fleet_logs
        FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
  `);
  await knex.raw(`
    CREATE TRIGGER trg_audit_fleet_logs AFTER INSERT OR UPDATE OR DELETE ON fleet_logs
        FOR EACH ROW EXECUTE FUNCTION log_audit_event();
  `);

  await knex.raw(`ALTER TABLE fleet_logs ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`
    CREATE POLICY "Frota: Leitura" ON fleet_logs
        FOR SELECT USING (company_id = auth_company_id() AND deleted_at IS NULL);
  `);
  await knex.raw(`
    CREATE POLICY "Frota: Inserir" ON fleet_logs
        FOR INSERT WITH CHECK (company_id = auth_company_id());
  `);
  await knex.raw(`
    CREATE POLICY "Frota: Atualizar" ON fleet_logs
        FOR UPDATE USING (company_id = auth_company_id()) WITH CHECK (company_id = auth_company_id());
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS fleet_logs CASCADE;`);
};
