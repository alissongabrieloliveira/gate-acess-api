/**
 * Entrada/saída de visitantes e prestadores (de fora para dentro). Amarra
 * pessoa + veículo + portões + setor de destino.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE access_logs (
        id SERIAL PRIMARY KEY,
        company_id INT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        person_id INT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
        visited_person_id INT NULL REFERENCES people(id) ON DELETE RESTRICT,
        vehicle_id INT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
        destination_sector_id INT NULL REFERENCES sectors(id) ON DELETE RESTRICT,

        is_km_unavailable BOOLEAN DEFAULT FALSE,
        km_entry INT NULL,
        km_exit INT NULL,
        visit_reason VARCHAR(255) NULL,

        entry_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        entry_gate_id INT NOT NULL REFERENCES gates(id) ON DELETE RESTRICT,
        entry_operator_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

        exit_time TIMESTAMPTZ NULL,
        exit_gate_id INT NULL REFERENCES gates(id) ON DELETE RESTRICT,
        exit_operator_id INT NULL REFERENCES users(id) ON DELETE RESTRICT,

        receipt_code VARCHAR(50) NULL,
        signed_receipt_url TEXT NULL,

        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        observation TEXT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMPTZ NULL,

        CONSTRAINT chk_exit_after_entry CHECK (exit_time IS NULL OR exit_time >= entry_time),
        CONSTRAINT chk_km_logic CHECK (km_exit IS NULL OR km_entry IS NULL OR km_exit >= km_entry),
        CONSTRAINT chk_access_km_non_negative CHECK (
            (km_entry IS NULL OR km_entry >= 0) AND (km_exit IS NULL OR km_exit >= 0)
        )
    );
  `);

  await knex.raw(`CREATE INDEX idx_access_logs_company_id ON access_logs(company_id);`);
  await knex.raw(`CREATE INDEX idx_access_logs_status ON access_logs(status);`);
  await knex.raw(`
    CREATE INDEX idx_access_logs_active ON access_logs(company_id) WHERE status = 'ACTIVE';
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_access_logs_receipt ON access_logs(company_id, receipt_code) WHERE receipt_code IS NOT NULL;
  `);

  await knex.raw(`
    CREATE TRIGGER trg_access_logs_updated_at BEFORE UPDATE ON access_logs
        FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
  `);
  await knex.raw(`
    CREATE TRIGGER trg_audit_access_logs AFTER INSERT OR UPDATE OR DELETE ON access_logs
        FOR EACH ROW EXECUTE FUNCTION log_audit_event();
  `);

  await knex.raw(`ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`
    CREATE POLICY "Acessos: Leitura" ON access_logs
        FOR SELECT USING (company_id = auth_company_id() AND deleted_at IS NULL);
  `);
  await knex.raw(`
    CREATE POLICY "Acessos: Inserir" ON access_logs
        FOR INSERT WITH CHECK (company_id = auth_company_id());
  `);
  await knex.raw(`
    CREATE POLICY "Acessos: Atualizar" ON access_logs
        FOR UPDATE USING (company_id = auth_company_id()) WITH CHECK (company_id = auth_company_id());
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS access_logs CASCADE;`);
};
