/**
 * Operadores/porteiros com login no PWA. Dados sensíveis criptografados (name/cpf/email)
 * + blind index (HMAC) para permitir busca/unicidade sem descriptografar em massa.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        company_id INT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        name_encrypted VARCHAR(255) NOT NULL,
        cpf_encrypted TEXT NOT NULL,
        email_encrypted TEXT NOT NULL,
        -- Preenchidos pela aplicação via generate_bindex(cpf) / generate_bindex(email).
        cpf_bindex VARCHAR(64) UNIQUE NOT NULL,
        email_bindex VARCHAR(64) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        rules INT NOT NULL DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        email_verified_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMPTZ NULL
    );
  `);

  await knex.raw(`CREATE INDEX idx_users_company_id ON users(company_id);`);
  await knex.raw(`
    CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
  `);

  await knex.raw(`ALTER TABLE users ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`
    CREATE POLICY "Leitura de usuários da mesma empresa" ON users
        FOR SELECT USING (company_id = auth_company_id() AND deleted_at IS NULL);
  `);
  await knex.raw(`
    CREATE POLICY "Atualização do próprio perfil" ON users
        FOR UPDATE USING (id = auth_user_id())
        WITH CHECK (id = auth_user_id() AND company_id = auth_company_id());
  `);
  // Nenhuma política de INSERT definida propositalmente: com RLS habilitado, a ausência
  // de policy bloqueia a operação por padrão. Criação de operador só é possível via papel
  // com bypass de RLS (ex.: service role/admin no backend).
};

exports.down = async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS users CASCADE;`);
};
