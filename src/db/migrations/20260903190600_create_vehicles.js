/**
 * Veículos (de visitantes ou da frota própria), sem vínculo fixo com people.
 * Unicidade de placa é PARCIAL (só entre veículos "vivos") para permitir reaproveitar
 * uma placa após soft-delete/venda do cadastro anterior.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE vehicles (
        id SERIAL PRIMARY KEY,
        company_id INT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        vehicle_type INT NOT NULL DEFAULT 1,
        license_plate VARCHAR(10) NOT NULL,
        brand VARCHAR(50) NULL,
        model VARCHAR(50) NULL,
        color VARCHAR(30) NULL,
        operation_status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
        is_blocked BOOLEAN DEFAULT FALSE,
        block_reason TEXT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMPTZ NULL
    );
  `);

  await knex.raw(`CREATE INDEX idx_vehicles_company_id ON vehicles(company_id);`);
  await knex.raw(`CREATE INDEX idx_vehicles_license_plate ON vehicles(license_plate);`);
  await knex.raw(`CREATE INDEX idx_vehicles_operation_status ON vehicles(operation_status);`);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_vehicles_plate_unique ON vehicles(company_id, license_plate) WHERE deleted_at IS NULL;
  `);

  await knex.raw(`
    CREATE TRIGGER trg_vehicles_updated_at BEFORE UPDATE ON vehicles
        FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
  `);
  await knex.raw(`
    CREATE TRIGGER trg_audit_vehicles AFTER INSERT OR UPDATE OR DELETE ON vehicles
        FOR EACH ROW EXECUTE FUNCTION log_audit_event();
  `);

  await knex.raw(`ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`
    CREATE POLICY "Leitura de veículos" ON vehicles
        FOR SELECT USING (company_id = auth_company_id() AND deleted_at IS NULL);
  `);
  await knex.raw(`
    CREATE POLICY "Inserção de veículos" ON vehicles
        FOR INSERT WITH CHECK (company_id = auth_company_id());
  `);
  await knex.raw(`
    CREATE POLICY "Atualização de veículos" ON vehicles
        FOR UPDATE USING (company_id = auth_company_id()) WITH CHECK (company_id = auth_company_id());
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS vehicles CASCADE;`);
};
