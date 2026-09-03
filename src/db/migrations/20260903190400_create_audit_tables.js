/**
 * Sistema de auditoria: login_logs (histórico de logins) e audit_logs (trilha
 * "antes/depois" em JSONB), mais a função de trigger que popula audit_logs
 * automaticamente em INSERT/UPDATE/DELETE das tabelas de negócio.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE login_logs (
        id SERIAL PRIMARY KEY,
        company_id INT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        login_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45) NULL,
        user_agent TEXT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS'
    );
  `);
  await knex.raw(`CREATE INDEX idx_login_logs_company_id ON login_logs(company_id);`);
  await knex.raw(`CREATE INDEX idx_login_logs_user_id ON login_logs(user_id);`);
  await knex.raw(`ALTER TABLE login_logs ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`
    CREATE POLICY "Leitura de logins da mesma empresa" ON login_logs
        FOR SELECT USING (company_id = auth_company_id());
  `);

  await knex.raw(`
    CREATE TABLE audit_logs (
        id SERIAL PRIMARY KEY,
        company_id INT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        user_id INT NULL REFERENCES users(id) ON DELETE RESTRICT,
        table_name VARCHAR(100) NOT NULL,
        record_id INT NOT NULL,
        action VARCHAR(10) NOT NULL,
        old_data JSONB NULL,
        new_data JSONB NULL,
        changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await knex.raw(`CREATE INDEX idx_audit_logs_company ON audit_logs(company_id);`);
  await knex.raw(`CREATE INDEX idx_audit_logs_table_record ON audit_logs(table_name, record_id);`);
  await knex.raw(`CREATE INDEX idx_audit_logs_changed_at ON audit_logs(changed_at);`);
  // Recomendação futura (não implementada aqui para não acoplar a uma estratégia
  // específica de infra): particionamento por mês (PARTITION BY RANGE (changed_at))
  // e política de retenção/expurgo, alinhada ao princípio de minimização de dados da LGPD.

  await knex.raw(`ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`
    CREATE POLICY "Leitura de auditoria da mesma empresa" ON audit_logs
        FOR SELECT USING (company_id = auth_company_id());
  `);

  // Intercepta INSERT/UPDATE/DELETE nas tabelas de negócio e grava o histórico em
  // audit_logs, lendo quem fez a alteração do JWT. user_id fica NULL quando a operação
  // ocorre fora de um contexto de JWT (jobs, migrations, service_role) — esperado,
  // representa "sistema/processo automatizado". search_path fixado por ser SECURITY DEFINER.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION log_audit_event() RETURNS TRIGGER AS $$
    DECLARE
        v_user_id INT; v_company_id INT;
    BEGIN
        BEGIN
            v_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::INT;
            v_company_id := (current_setting('request.jwt.claims', true)::json->>'company_id')::INT;
        EXCEPTION WHEN OTHERS THEN
            v_user_id := NULL; v_company_id := NULL;
        END;

        IF (TG_OP = 'UPDATE') THEN
            INSERT INTO audit_logs (company_id, user_id, table_name, record_id, action, old_data, new_data)
            VALUES (COALESCE(NEW.company_id, v_company_id), v_user_id, TG_TABLE_NAME, OLD.id, TG_OP, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
            RETURN NEW;
        ELSIF (TG_OP = 'DELETE') THEN
            INSERT INTO audit_logs (company_id, user_id, table_name, record_id, action, old_data)
            VALUES (COALESCE(OLD.company_id, v_company_id), v_user_id, TG_TABLE_NAME, OLD.id, TG_OP, row_to_json(OLD)::jsonb);
            RETURN OLD;
        ELSIF (TG_OP = 'INSERT') THEN
            INSERT INTO audit_logs (company_id, user_id, table_name, record_id, action, new_data)
            VALUES (COALESCE(NEW.company_id, v_company_id), v_user_id, TG_TABLE_NAME, NEW.id, TG_OP, NULL, row_to_json(NEW)::jsonb);
            RETURN NEW;
        END IF;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP FUNCTION IF EXISTS log_audit_event() CASCADE;`);
  await knex.raw(`DROP TABLE IF EXISTS audit_logs CASCADE;`);
  await knex.raw(`DROP TABLE IF EXISTS login_logs CASCADE;`);
};
