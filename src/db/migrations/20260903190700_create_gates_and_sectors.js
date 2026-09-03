/**
 * Cadastros básicos de "por onde entrou?" (gates) e "para onde vai?" (sectors).
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE gates (
        id SERIAL PRIMARY KEY,
        company_id INT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        name VARCHAR(100) NOT NULL,
        description TEXT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMPTZ NULL,
        UNIQUE (company_id, name)
    );
  `);
  await knex.raw(`
    CREATE TRIGGER trg_gates_updated_at BEFORE UPDATE ON gates
        FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
  `);
  await knex.raw(`
    CREATE TRIGGER trg_audit_gates AFTER INSERT OR UPDATE OR DELETE ON gates
        FOR EACH ROW EXECUTE FUNCTION log_audit_event();
  `);
  await knex.raw(`ALTER TABLE gates ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`
    CREATE POLICY "Políticas de portões (Leitura)" ON gates
        FOR SELECT USING (company_id = auth_company_id() AND deleted_at IS NULL);
  `);
  await knex.raw(`
    CREATE POLICY "Políticas de portões (Inserir)" ON gates
        FOR INSERT WITH CHECK (company_id = auth_company_id());
  `);
  await knex.raw(`
    CREATE POLICY "Políticas de portões (Atualizar)" ON gates
        FOR UPDATE USING (company_id = auth_company_id()) WITH CHECK (company_id = auth_company_id());
  `);

  await knex.raw(`
    CREATE TABLE sectors (
        id SERIAL PRIMARY KEY,
        company_id INT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        name VARCHAR(100) NOT NULL,
        description TEXT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMPTZ NULL,
        UNIQUE (company_id, name)
    );
  `);
  await knex.raw(`
    CREATE TRIGGER trg_sectors_updated_at BEFORE UPDATE ON sectors
        FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
  `);
  await knex.raw(`
    CREATE TRIGGER trg_audit_sectors AFTER INSERT OR UPDATE OR DELETE ON sectors
        FOR EACH ROW EXECUTE FUNCTION log_audit_event();
  `);
  await knex.raw(`ALTER TABLE sectors ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`
    CREATE POLICY "Políticas de setores (Leitura)" ON sectors
        FOR SELECT USING (company_id = auth_company_id() AND deleted_at IS NULL);
  `);
  await knex.raw(`
    CREATE POLICY "Políticas de setores (Inserir)" ON sectors
        FOR INSERT WITH CHECK (company_id = auth_company_id());
  `);
  await knex.raw(`
    CREATE POLICY "Políticas de setores (Atualizar)" ON sectors
        FOR UPDATE USING (company_id = auth_company_id()) WITH CHECK (company_id = auth_company_id());
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS sectors CASCADE;`);
  await knex.raw(`DROP TABLE IF EXISTS gates CASCADE;`);
};
