/**
 * Dispositivo "gateway" local (processo Node na rede do cliente que fala com
 * a controladora de cancela — ver projeto gate-controller). Autenticação por
 * token opaco de alta entropia, mesmo padrão de refresh_tokens: só o hash é
 * persistido, nunca o valor bruto.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE gateway_devices (
        id SERIAL PRIMARY KEY,
        company_id INT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        name VARCHAR(100) NOT NULL,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        last_seen_at TIMESTAMPTZ NULL,
        revoked_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await knex.raw(`CREATE INDEX idx_gateway_devices_company_id ON gateway_devices(company_id);`);

  // "1 gateway por empresa" (decisão de produto por enquanto) — índice único
  // PARCIAL (não UNIQUE(company_id) puro) pra permitir provisionar um
  // dispositivo de reposição depois de revogar o antigo, mesmo padrão de
  // soft-revoke de refresh_tokens.revoked_at.
  await knex.raw(`
    CREATE UNIQUE INDEX idx_gateway_devices_one_active_per_company
        ON gateway_devices(company_id) WHERE revoked_at IS NULL;
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS gateway_devices CASCADE;`);
};
