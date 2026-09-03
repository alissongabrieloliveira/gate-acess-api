/**
 * Bug no gate_schema.sql original: o branch de INSERT de log_audit_event() lista 6
 * colunas (company_id, user_id, table_name, record_id, action, new_data) mas passa 7
 * valores (um NULL sobrando antes de row_to_json(NEW)::jsonb) — Postgres rejeita com
 * "INSERT has more expressions than target columns" (42601). Passou despercebido até
 * agora porque nenhuma tabela com trg_audit_* tinha recebido um INSERT de verdade
 * ainda (só users/companies foram exercitados antes, e nenhuma das duas tem trigger
 * de auditoria). Corrige recriando a função (CREATE OR REPLACE) com o NULL removido.
 */
exports.up = async function up(knex) {
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
            VALUES (COALESCE(NEW.company_id, v_company_id), v_user_id, TG_TABLE_NAME, NEW.id, TG_OP, row_to_json(NEW)::jsonb);
            RETURN NEW;
        END IF;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
  `);
};

exports.down = async function down(knex) {
  // Restaura o comportamento anterior (com bug) por simetria de migração — não deve
  // ser usado de fato, é só para a migration ser reversível.
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
