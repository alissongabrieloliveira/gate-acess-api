/**
 * RLS real — etapa 2 (claude.md seção 5.5). Login, esqueci a senha, refresh,
 * redefinir senha e a conexão do gateway começam SEM empresa no contexto: só
 * têm um e-mail ou um token. Com RLS valendo, a busca inicial não acharia nada
 * (a policy exige a empresa da claim).
 *
 * Estas funções respondem só "a qual empresa pertence este e-mail/token" — um
 * inteiro, nada mais. Com a empresa em mãos, o backend segue o fluxo normal
 * dentro do contexto dela (utils/tenantContext.js), e o resto das consultas
 * passa pelas policies como qualquer outra.
 *
 * SECURITY DEFINER: rodam como o dono das tabelas (que ignora RLS), por isso
 * ficam num schema próprio (`app_private`, fora do que a Data API do Supabase
 * expõe) e sem EXECUTE para PUBLIC/anon/authenticated. Hoje o backend é o dono
 * e executa normalmente; o papel próprio da aplicação (etapa 3) recebe o
 * EXECUTE explicitamente.
 */
const LOOKUPS = [
  ['company_id_for_email_bindex', 'users', 'email_bindex', 'AND deleted_at IS NULL'],
  ['company_id_for_refresh_token', 'refresh_tokens', 'token_hash', ''],
  ['company_id_for_password_reset_token', 'password_reset_tokens', 'token_hash', ''],
  ['company_id_for_gateway_token', 'gateway_devices', 'token_hash', ''],
];

exports.up = async function up(knex) {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS app_private;');
  await knex.raw('REVOKE ALL ON SCHEMA app_private FROM PUBLIC;');

  for (const [name, table, column, extraCondition] of LOOKUPS) {
    await knex.raw(`
      CREATE OR REPLACE FUNCTION app_private.${name}(p_value TEXT) RETURNS INT AS $$
          SELECT company_id FROM public.${table} WHERE ${column} = p_value ${extraCondition} LIMIT 1
      $$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;
    `);
    await knex.raw(`REVOKE ALL ON FUNCTION app_private.${name}(TEXT) FROM PUBLIC;`);
  }

  // Supabase concede EXECUTE em funções novas para anon/authenticated por
  // privilégio padrão — revoga explicitamente. Fora do Supabase os papéis não
  // existem e o passo é pulado (mesmo padrão da migration 20260928120000).
  await knex.raw(`
    DO $$
    DECLARE
      r TEXT;
    BEGIN
      FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
          EXECUTE format('REVOKE ALL ON SCHEMA app_private FROM %I', r);
          EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM %I', r);
        END IF;
      END LOOP;
    END
    $$;
  `);
};

exports.down = async function down(knex) {
  for (const [name] of LOOKUPS) {
    await knex.raw(`DROP FUNCTION IF EXISTS app_private.${name}(TEXT);`);
  }
  await knex.raw('DROP SCHEMA IF EXISTS app_private;');
};
