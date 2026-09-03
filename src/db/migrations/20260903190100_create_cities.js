/**
 * Tabela global (sem company_id) de cidades (IBGE), compartilhada entre todos os tenants.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE cities (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        state_abbr CHAR(2) NOT NULL,
        ibge_code VARCHAR(7) UNIQUE NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMPTZ NULL,
        UNIQUE (name, state_abbr)
    );
  `);

  await knex.raw(`CREATE INDEX idx_cities_name ON cities(name);`);
  await knex.raw(`CREATE INDEX idx_cities_state_abbr ON cities(state_abbr);`);
  await knex.raw(`
    CREATE TRIGGER trg_cities_updated_at BEFORE UPDATE ON cities
        FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
  `);

  await knex.raw(`ALTER TABLE cities ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`
    CREATE POLICY "Permitir leitura de cidades para todos" ON cities
        FOR SELECT USING (current_setting('request.jwt.claims', true) IS NOT NULL AND deleted_at IS NULL);
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS cities CASCADE;`);
};
