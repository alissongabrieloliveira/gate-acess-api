// Papel da aplicação (app_runtime, migration 20261012150000). Protege a regra
// de que o RLS é uma barreira de verdade (claude.md seção 5.5): o papel não pode
// ser dono nem ignorar RLS, e toda tabela do schema public precisa estar coberta
// — RLS ligado, policies e GRANT para o papel. Tabela nova sem isso faz este
// teste falhar (e a API sob teste nem consegue lê-la).
const db = require('../helpers/db');

const APP_ROLE = 'app_runtime';
const KNEX_TABLES = ['knex_migrations', 'knex_migrations_lock'];

describe('Papel app_runtime', () => {
  afterAll(async () => {
    await db.destroy();
  });

  test('não é superusuário, não ignora RLS e não é dono de nenhuma tabela', async () => {
    const role = await db('pg_roles').where({ rolname: APP_ROLE }).first('rolsuper', 'rolbypassrls');
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });

    const owned = await db.raw(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = ?`,
      [APP_ROLE]
    );
    expect(owned.rows).toEqual([]);
  });

  test('a API sob teste conecta com o papel app_runtime', async () => {
    const appDb = require('../../src/config/db');
    const result = await appDb.raw('SELECT current_user AS user');
    expect(result.rows[0].user).toBe(APP_ROLE);
  });

  test('toda tabela do schema public tem RLS ligado, policies e acesso do papel', async () => {
    const result = await db.raw(
      `SELECT c.relname AS table,
              c.relrowsecurity AS rls,
              (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies,
              has_table_privilege(?, c.oid, 'SELECT') AS can_select
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> ALL(?)
        ORDER BY c.relname`,
      [APP_ROLE, KNEX_TABLES]
    );
    const uncovered = result.rows.filter((row) => !row.rls || row.policies === 0 || !row.can_select);
    expect(uncovered).toEqual([]);
  });

  test('sem acesso às tabelas de controle das migrations', async () => {
    for (const table of KNEX_TABLES) {
      const result = await db.raw(`SELECT has_table_privilege(?, ?, 'SELECT') AS can_select`, [APP_ROLE, table]);
      expect({ table, canSelect: result.rows[0].can_select }).toEqual({ table, canSelect: false });
    }
  });

  test('não apaga registro de verdade (só soft delete), exceto saída de cancela', async () => {
    const result = await db.raw(
      `SELECT c.relname AS table
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND has_table_privilege(?, c.oid, 'DELETE')`,
      [APP_ROLE]
    );
    expect(result.rows.map((row) => row.table)).toEqual(['gate_direction_outputs']);
  });
});
