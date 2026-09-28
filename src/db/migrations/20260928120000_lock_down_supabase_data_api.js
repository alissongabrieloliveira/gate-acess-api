/**
 * Fecha a Data API do Supabase (PostgREST) sobre o schema `public`.
 *
 * O Supabase expõe as tabelas do `public` pela Data API para as roles `anon`
 * e `authenticated`, e por padrão concede a elas ALL nas tabelas novas. As
 * tabelas de negócio têm RLS com policies que exigem `company_id` na claim
 * (a chave anon não tem), mas 5 tabelas nasceram SEM RLS — em especial
 * `refresh_tokens`: quem tivesse a chave anon poderia inserir um refresh
 * token com hash conhecido para qualquer usuário e trocá-lo por um access
 * token em `/auth/refresh`.
 *
 * O backend não usa a Data API (conecta direto no Postgres como dono das
 * tabelas, o que ignora RLS), então:
 * 1. Liga RLS nas 5 tabelas que não tinham (sem policy = nega tudo para quem
 *    não é dono).
 * 2. Se as roles do Supabase existirem, revoga delas tudo no `public` e os
 *    privilégios padrão para tabelas/sequences futuras criadas por esta role.
 *    Fora do Supabase (dev/teste/CI) as roles não existem e o passo é pulado.
 */
const TABLES_WITHOUT_RLS = [
  'refresh_tokens',
  'password_reset_tokens',
  'gateway_devices',
  'knex_migrations',
  'knex_migrations_lock',
];

exports.up = async function up(knex) {
  for (const table of TABLES_WITHOUT_RLS) {
    await knex.raw('ALTER TABLE ?? ENABLE ROW LEVEL SECURITY;', [table]);
  }

  await knex.raw(`
    DO $$
    DECLARE
      r TEXT;
    BEGIN
      FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
          EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
          EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
          EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
          EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
        END IF;
      END LOOP;
    END
    $$;
  `);
};

// Só desliga o RLS. Os privilégios revogados das roles do Supabase NÃO são
// devolvidos de propósito — reabrir a Data API nunca é o que se quer.
exports.down = async function down(knex) {
  for (const table of TABLES_WITHOUT_RLS) {
    await knex.raw('ALTER TABLE ?? DISABLE ROW LEVEL SECURITY;', [table]);
  }
};
