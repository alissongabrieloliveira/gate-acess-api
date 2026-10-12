/**
 * RLS real — etapa 3 (claude.md seção 5.5). Papel de banco próprio da
 * aplicação: NÃO é dono das tabelas e não tem BYPASSRLS, então as policies
 * (migration 20261012130000) valem para ele. Migrations e seeds continuam
 * rodando com o dono (MIGRATION_DATABASE_URL, ver knexfile.js).
 *
 * Nasce NOLOGIN: a senha e o LOGIN são configurados fora do código — no
 * Postgres local pelo tests/globalSetup.js, no Supabase pelo SQL Editor quando
 * a produção for trocar (etapa 4). Sem isso o papel existe mas não conecta.
 *
 * Permissões explícitas, só o que o código usa. Tabela nova NÃO entra
 * sozinha (sem ALTER DEFAULT PRIVILEGES de propósito): quem criar uma tabela
 * precisa dar o GRANT aqui e criar as policies dela — o teste
 * tests/integration/app-runtime-role.test.js falha enquanto isso não for feito.
 */
const ROLE = 'app_runtime';

const TABLE_GRANTS = {
  people: 'SELECT, INSERT, UPDATE',
  vehicles: 'SELECT, INSERT, UPDATE',
  gates: 'SELECT, INSERT, UPDATE',
  sectors: 'SELECT, INSERT, UPDATE',
  access_logs: 'SELECT, INSERT, UPDATE',
  fleet_logs: 'SELECT, INSERT, UPDATE',
  users: 'SELECT, INSERT, UPDATE',
  login_logs: 'SELECT, INSERT',
  audit_logs: 'SELECT, INSERT, UPDATE',
  refresh_tokens: 'SELECT, INSERT, UPDATE',
  password_reset_tokens: 'SELECT, INSERT, UPDATE',
  gateway_devices: 'SELECT, INSERT, UPDATE',
  gate_direction_outputs: 'SELECT, INSERT, UPDATE, DELETE',
  companies: 'SELECT, UPDATE',
  cities: 'SELECT',
};

exports.up = async function up(knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
        CREATE ROLE ${ROLE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
    END
    $$;
  `);

  await knex.raw(`GRANT USAGE ON SCHEMA public TO ${ROLE};`);
  for (const [table, privileges] of Object.entries(TABLE_GRANTS)) {
    await knex.raw(`GRANT ${privileges} ON TABLE ?? TO ${ROLE};`, [table]);
  }
  // nextval() dos SERIAL nos INSERTs.
  await knex.raw(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${ROLE};`);

  await knex.raw(`GRANT USAGE ON SCHEMA app_private TO ${ROLE};`);
  await knex.raw(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO ${ROLE};`);
};

exports.down = async function down(knex) {
  await knex.raw(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM ${ROLE};`);
  await knex.raw(`REVOKE ALL ON SCHEMA app_private FROM ${ROLE};`);
  await knex.raw(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${ROLE};`);
  await knex.raw(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ROLE};`);
  await knex.raw(`REVOKE ALL ON SCHEMA public FROM ${ROLE};`);
  // O papel é do servidor inteiro (no Postgres local, dev e teste dividem o
  // mesmo): só é removido se não tiver mais permissão em nenhum outro banco.
  await knex.raw(`
    DO $$
    BEGIN
      DROP ROLE IF EXISTS ${ROLE};
    EXCEPTION WHEN dependent_objects_still_exist THEN
      RAISE NOTICE 'Papel ${ROLE} mantido: ainda tem permissões em outro banco';
    END
    $$;
  `);
};
