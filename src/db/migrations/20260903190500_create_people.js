/**
 * Visitantes, prestadores e funcionários. Mesma trava de segurança LGPD dos usuários
 * (dados criptografados + blind index de CPF).
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE people (
        id SERIAL PRIMARY KEY,
        company_id INT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        person_type INT NOT NULL DEFAULT 1,
        name_encrypted VARCHAR(255) NOT NULL,
        cpf_encrypted TEXT NULL,
        rg_encrypted TEXT NULL,
        cpf_bindex VARCHAR(64) NULL,
        phone_encrypted TEXT NULL,
        photo_url TEXT NULL,
        is_blocked BOOLEAN DEFAULT FALSE,
        block_reason TEXT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMPTZ NULL,
        UNIQUE (company_id, cpf_bindex)
    );
  `);

  await knex.raw(`CREATE INDEX idx_people_company_id ON people(company_id);`);
  await knex.raw(`CREATE INDEX idx_people_type ON people(person_type);`);
  await knex.raw(`
    CREATE TRIGGER trg_people_updated_at BEFORE UPDATE ON people
        FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
  `);
  await knex.raw(`
    CREATE TRIGGER trg_audit_people AFTER INSERT OR UPDATE OR DELETE ON people
        FOR EACH ROW EXECUTE FUNCTION log_audit_event();
  `);

  await knex.raw(`ALTER TABLE people ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`
    CREATE POLICY "Leitura de pessoas" ON people
        FOR SELECT USING (company_id = auth_company_id() AND deleted_at IS NULL);
  `);
  await knex.raw(`
    CREATE POLICY "Inserção de pessoas" ON people
        FOR INSERT WITH CHECK (company_id = auth_company_id());
  `);
  await knex.raw(`
    CREATE POLICY "Atualização de pessoas" ON people
        FOR UPDATE USING (company_id = auth_company_id()) WITH CHECK (company_id = auth_company_id());
  `);
  // Nenhuma política de DELETE definida propositalmente: exclusão física fica impossível
  // via API — a única via suportada é soft delete (UPDATE deleted_at).
};

exports.down = async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS people CASCADE;`);
};
