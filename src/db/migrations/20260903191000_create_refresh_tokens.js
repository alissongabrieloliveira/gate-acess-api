/**
 * Refresh tokens (não contemplados no schema SQL original). Armazena apenas o hash
 * do token (nunca em texto puro); rotação obrigatória a cada uso — replaced_by_id
 * permite detectar reuso indevido de token já rotacionado (sinal de roubo de token).
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE refresh_tokens (
        id SERIAL PRIMARY KEY,
        company_id INT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ NULL,
        replaced_by_id INT NULL REFERENCES refresh_tokens(id) ON DELETE SET NULL,
        ip_address VARCHAR(45) NULL,
        user_agent TEXT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await knex.raw(`CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);`);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS refresh_tokens CASCADE;`);
};
