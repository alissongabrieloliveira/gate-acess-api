/**
 * Empresas (tenants) — o coração do multi-tenant. CNPJ validado matematicamente
 * e normalizado (só dígitos) antes de gravar.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE companies (
        id SERIAL PRIMARY KEY,
        corporate_name VARCHAR(255) NOT NULL,
        trade_name VARCHAR(255),
        -- Coluna alargada para 20 chars para aceitar CNPJ formatado vindo da aplicação
        -- antes do trigger de normalização limpar o valor (sempre 14 dígitos após salvar).
        cnpj VARCHAR(20) UNIQUE NOT NULL,
        zip_code VARCHAR(8),
        street VARCHAR(255),
        address_number VARCHAR(50),
        complement VARCHAR(100),
        neighborhood VARCHAR(100),
        city_id INT NULL REFERENCES cities(id) ON DELETE SET NULL,
        -- Fallback para quando city_id é NULL (endereço no exterior ou cidade não
        -- encontrada); sincronizado automaticamente por trigger quando city_id existe.
        state CHAR(2),
        contact_email VARCHAR(255),
        contact_phone VARCHAR(20),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMPTZ NULL,
        CONSTRAINT chk_valid_cnpj CHECK (is_valid_cnpj(cnpj))
    );
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION normalize_company_cnpj() RETURNS TRIGGER AS $$
    BEGIN
        NEW.cnpj := regexp_replace(NEW.cnpj, '[^0-9]', '', 'g');
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await knex.raw(`
    CREATE TRIGGER trg_companies_normalize_cnpj BEFORE INSERT OR UPDATE ON companies
        FOR EACH ROW EXECUTE FUNCTION normalize_company_cnpj();
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION sync_company_state() RETURNS TRIGGER AS $$
    BEGIN
        IF NEW.city_id IS NOT NULL THEN
            SELECT state_abbr INTO NEW.state FROM cities WHERE id = NEW.city_id;
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await knex.raw(`
    CREATE TRIGGER trg_companies_sync_state BEFORE INSERT OR UPDATE ON companies
        FOR EACH ROW EXECUTE FUNCTION sync_company_state();
  `);

  await knex.raw(`
    CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON companies
        FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
  `);

  await knex.raw(`ALTER TABLE companies ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`
    CREATE POLICY "Permitir leitura da própria empresa" ON companies
        FOR SELECT USING (id = auth_company_id() AND deleted_at IS NULL);
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS companies CASCADE;`);
  await knex.raw(`DROP FUNCTION IF EXISTS sync_company_state();`);
  await knex.raw(`DROP FUNCTION IF EXISTS normalize_company_cnpj();`);
};
