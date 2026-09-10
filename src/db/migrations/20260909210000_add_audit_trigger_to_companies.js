/**
 * Pedido do usuário: edição dos dados da empresa (Configurações, PUT
 * /companies/me) precisa aparecer em Relatórios > Auditoria. `companies`
 * nunca teve `trg_audit_*` (só people/vehicles/gates/sectors/access_logs/
 * fleet_logs têm — ver create_audit_tables) porque a tabela não existia
 * ainda quando esse trigger foi desenhado como "próximos passos" read-only.
 *
 * Não dá pra só criar o trigger com a `log_audit_event()` existente: a
 * função lê `NEW.company_id`/`OLD.company_id` pra saber a qual empresa o
 * evento pertence — funciona pra todo o resto (tabelas filhas de uma
 * empresa), mas `companies` não tem coluna `company_id` (ela PRÓPRIA é a
 * empresa), então `NEW.company_id` explodiria em runtime ("record 'new' has
 * no field 'company_id'"). Corrige com `CREATE OR REPLACE` acrescentando um
 * `IF TG_TABLE_NAME = 'companies'` que usa `NEW.id`/`OLD.id` nesse caso
 * específico — comportamento idêntico ao anterior para as outras 6 tabelas.
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

  await knex.raw(`
    CREATE TRIGGER trg_audit_companies AFTER INSERT OR UPDATE OR DELETE ON companies
        FOR EACH ROW EXECUTE FUNCTION log_audit_event();
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP TRIGGER IF EXISTS trg_audit_companies ON companies;`);
  // Restaura a função sem o caso especial de companies (comportamento
  // anterior a esta migration) — reversível por simetria, não deve ser
  // usado de fato em produção.
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
