/**
 * Tokens de recuperação de senha ("esqueci minha senha"). Mesmo formato de
 * refresh_tokens (20260903191000_create_refresh_tokens.js): opaco, só o
 * hash é persistido (nunca o valor bruto), alta entropia dispensa hash
 * mais caro que SHA-256. `used_at` em vez de `revoked_at` porque
 * semanticamente é "usado" (marca de uso único), não "revogado".
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE password_reset_tokens (
        id SERIAL PRIMARY KEY,
        company_id INT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await knex.raw(`CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);`);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS password_reset_tokens CASCADE;`);
};
