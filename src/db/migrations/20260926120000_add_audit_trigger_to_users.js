/**
 * LGPD/prestação de contas: criar operador, mudar permissão (rules),
 * desativar ou remover um usuário não deixava rastro em audit_logs —
 * `users` nunca teve trg_audit_*. O receio antigo (duplicar dado pessoal em
 * claro na trilha) não se aplica: nome/CPF/e-mail já são *_encrypted, então
 * a trilha guarda o texto cifrado, igual a `people`.
 *
 * O que NÃO pode ir pra trilha é o `password_hash`: a função passa a remover
 * essa chave dos snapshots (`- 'password_hash'`). Nas outras tabelas a chave
 * não existe e o operador `-` não muda nada.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION log_audit_event() RETURNS TRIGGER AS $$
    DECLARE
        v_user_id INT; v_company_id INT; v_row_company_id INT;
    BEGIN
        BEGIN
            v_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::INT;
            v_company_id := (current_setting('request.jwt.claims', true)::json->>'company_id')::INT;
        EXCEPTION WHEN OTHERS THEN
            v_user_id := NULL; v_company_id := NULL;
        END;

        IF (TG_OP = 'UPDATE') THEN
            IF TG_TABLE_NAME = 'companies' THEN v_row_company_id := NEW.id; ELSE v_row_company_id := NEW.company_id; END IF;
            INSERT INTO audit_logs (company_id, user_id, table_name, record_id, action, old_data, new_data)
            VALUES (COALESCE(v_row_company_id, v_company_id), v_user_id, TG_TABLE_NAME, OLD.id, TG_OP, (row_to_json(OLD)::jsonb - 'password_hash'), (row_to_json(NEW)::jsonb - 'password_hash'));
            RETURN NEW;
        ELSIF (TG_OP = 'DELETE') THEN
            IF TG_TABLE_NAME = 'companies' THEN v_row_company_id := OLD.id; ELSE v_row_company_id := OLD.company_id; END IF;
            INSERT INTO audit_logs (company_id, user_id, table_name, record_id, action, old_data)
            VALUES (COALESCE(v_row_company_id, v_company_id), v_user_id, TG_TABLE_NAME, OLD.id, TG_OP, (row_to_json(OLD)::jsonb - 'password_hash'));
            RETURN OLD;
        ELSIF (TG_OP = 'INSERT') THEN
            IF TG_TABLE_NAME = 'companies' THEN v_row_company_id := NEW.id; ELSE v_row_company_id := NEW.company_id; END IF;
            INSERT INTO audit_logs (company_id, user_id, table_name, record_id, action, new_data)
            VALUES (COALESCE(v_row_company_id, v_company_id), v_user_id, TG_TABLE_NAME, NEW.id, TG_OP, (row_to_json(NEW)::jsonb - 'password_hash'));
            RETURN NEW;
        END IF;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
  `);

  await knex.raw(`
    CREATE TRIGGER trg_audit_users AFTER INSERT OR UPDATE OR DELETE ON users
        FOR EACH ROW EXECUTE FUNCTION log_audit_event();
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP TRIGGER IF EXISTS trg_audit_users ON users;`);
  // Volta a função da migration 20260909210000 (sem remover password_hash).
  await knex.raw(`
    CREATE OR REPLACE FUNCTION log_audit_event() RETURNS TRIGGER AS $$
    DECLARE
        v_user_id INT; v_company_id INT; v_row_company_id INT;
    BEGIN
        BEGIN
            v_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::INT;
            v_company_id := (current_setting('request.jwt.claims', true)::json->>'company_id')::INT;
        EXCEPTION WHEN OTHERS THEN
            v_user_id := NULL; v_company_id := NULL;
        END;

        IF (TG_OP = 'UPDATE') THEN
            IF TG_TABLE_NAME = 'companies' THEN v_row_company_id := NEW.id; ELSE v_row_company_id := NEW.company_id; END IF;
            INSERT INTO audit_logs (company_id, user_id, table_name, record_id, action, old_data, new_data)
            VALUES (COALESCE(v_row_company_id, v_company_id), v_user_id, TG_TABLE_NAME, OLD.id, TG_OP, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
            RETURN NEW;
        ELSIF (TG_OP = 'DELETE') THEN
            IF TG_TABLE_NAME = 'companies' THEN v_row_company_id := OLD.id; ELSE v_row_company_id := OLD.company_id; END IF;
            INSERT INTO audit_logs (company_id, user_id, table_name, record_id, action, old_data)
            VALUES (COALESCE(v_row_company_id, v_company_id), v_user_id, TG_TABLE_NAME, OLD.id, TG_OP, row_to_json(OLD)::jsonb);
            RETURN OLD;
        ELSIF (TG_OP = 'INSERT') THEN
            IF TG_TABLE_NAME = 'companies' THEN v_row_company_id := NEW.id; ELSE v_row_company_id := NEW.company_id; END IF;
            INSERT INTO audit_logs (company_id, user_id, table_name, record_id, action, new_data)
            VALUES (COALESCE(v_row_company_id, v_company_id), v_user_id, TG_TABLE_NAME, NEW.id, TG_OP, row_to_json(NEW)::jsonb);
            RETURN NEW;
        END IF;
        RETURN NULL;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
  `);
};
