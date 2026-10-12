/**
 * Revisão das policies de RLS — etapa 1 de tornar o RLS uma barreira real
 * (claude.md seção 5.5). Esta migration NÃO muda o comportamento da API: o
 * backend continua conectando como dono das tabelas, e o dono ignora RLS. Ela
 * só deixa as policies prontas e coerentes com o que o código faz hoje, para
 * quando a aplicação passar a conectar com um papel sem ser dono.
 *
 * Não toca em nenhuma linha de dado — só policies e as duas funções de claim.
 *
 * O que estava errado nas policies originais (desenho da v1.0):
 * - SELECT escondia `deleted_at IS NOT NULL`: registro antigo ligado a portão,
 *   setor, pessoa ou operador removido perderia o nome, e soft delete com
 *   RETURNING seria recusado. O filtro de excluídos fica no código (já está).
 * - users: sem INSERT e com UPDATE só do próprio perfil (admin não criaria nem
 *   editaria operadores).
 * - login_logs: sem INSERT (login não gravaria o histórico).
 * - audit_logs: sem INSERT/UPDATE (a anonimização escreve direto nela; os
 *   triggers são SECURITY DEFINER e não dependem disso).
 * - refresh_tokens, password_reset_tokens, gateway_devices: RLS ligado sem
 *   nenhuma policy (nega tudo) — migration 20260928120000.
 * - gate_direction_outputs: sem DELETE, mas a tela /gate-control exclui saída.
 *
 * Regra nova, igual para todas: só o tenant da claim (`company_id`, ou `id` em
 * companies). Permissões de perfil (admin/operador) continuam no código
 * (`authorize`). DELETE só onde o código apaga de verdade. `cities` não muda.
 *
 * auth_company_id()/auth_user_id(): depois que uma transação usa
 * set_config(..., true), a conexão (reaproveitada pelo pool) passa a devolver
 * '' em current_setting em vez de NULL, e ''::json dá erro. As funções agora
 * tratam '' como "sem claim" (NULL), em vez de derrubar a consulta.
 */

const TENANT_TABLES = {
  people: ['SELECT', 'INSERT', 'UPDATE'],
  vehicles: ['SELECT', 'INSERT', 'UPDATE'],
  gates: ['SELECT', 'INSERT', 'UPDATE'],
  sectors: ['SELECT', 'INSERT', 'UPDATE'],
  access_logs: ['SELECT', 'INSERT', 'UPDATE'],
  fleet_logs: ['SELECT', 'INSERT', 'UPDATE'],
  users: ['SELECT', 'INSERT', 'UPDATE'],
  login_logs: ['SELECT', 'INSERT'],
  audit_logs: ['SELECT', 'INSERT', 'UPDATE'],
  refresh_tokens: ['SELECT', 'INSERT', 'UPDATE'],
  password_reset_tokens: ['SELECT', 'INSERT', 'UPDATE'],
  gateway_devices: ['SELECT', 'INSERT', 'UPDATE'],
  gate_direction_outputs: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  companies: ['SELECT', 'UPDATE'],
};

// Policies originais, recriadas idênticas no down.
const OLD_POLICIES = [
  ['companies', 'Permitir leitura da própria empresa', 'FOR SELECT USING (id = auth_company_id() AND deleted_at IS NULL)'],
  [
    'companies',
    'Permitir atualização da própria empresa',
    'FOR UPDATE USING (id = auth_company_id() AND deleted_at IS NULL) WITH CHECK (id = auth_company_id())',
  ],
  ['users', 'Leitura de usuários da mesma empresa', 'FOR SELECT USING (company_id = auth_company_id() AND deleted_at IS NULL)'],
  [
    'users',
    'Atualização do próprio perfil',
    'FOR UPDATE USING (id = auth_user_id()) WITH CHECK (id = auth_user_id() AND company_id = auth_company_id())',
  ],
  ['login_logs', 'Leitura de logins da mesma empresa', 'FOR SELECT USING (company_id = auth_company_id())'],
  ['audit_logs', 'Leitura de auditoria da mesma empresa', 'FOR SELECT USING (company_id = auth_company_id())'],
  ...crudPolicies('people', ['Leitura de pessoas', 'Inserção de pessoas', 'Atualização de pessoas']),
  ...crudPolicies('vehicles', ['Leitura de veículos', 'Inserção de veículos', 'Atualização de veículos']),
  ...crudPolicies('gates', [
    'Políticas de portões (Leitura)',
    'Políticas de portões (Inserir)',
    'Políticas de portões (Atualizar)',
  ]),
  ...crudPolicies('sectors', [
    'Políticas de setores (Leitura)',
    'Políticas de setores (Inserir)',
    'Políticas de setores (Atualizar)',
  ]),
  ...crudPolicies('access_logs', ['Acessos: Leitura', 'Acessos: Inserir', 'Acessos: Atualizar']),
  ...crudPolicies('fleet_logs', ['Frota: Leitura', 'Frota: Inserir', 'Frota: Atualizar']),
  ...crudPolicies(
    'gate_direction_outputs',
    [
      'Políticas de saídas de cancela (Leitura)',
      'Políticas de saídas de cancela (Inserir)',
      'Políticas de saídas de cancela (Atualizar)',
    ],
    { softDelete: false }
  ),
];

function crudPolicies(table, [selectName, insertName, updateName], { softDelete = true } = {}) {
  const notDeleted = softDelete ? ' AND deleted_at IS NULL' : '';
  return [
    [table, selectName, `FOR SELECT USING (company_id = auth_company_id()${notDeleted})`],
    [table, insertName, 'FOR INSERT WITH CHECK (company_id = auth_company_id())'],
    [table, updateName, 'FOR UPDATE USING (company_id = auth_company_id()) WITH CHECK (company_id = auth_company_id())'],
  ];
}

function newPolicyClause(table, operation) {
  const condition = table === 'companies' ? 'id = auth_company_id()' : 'company_id = auth_company_id()';
  if (operation === 'INSERT') return `FOR INSERT WITH CHECK (${condition})`;
  if (operation === 'UPDATE') return `FOR UPDATE USING (${condition}) WITH CHECK (${condition})`;
  return `FOR ${operation} USING (${condition})`;
}

function newPolicyName(operation) {
  return `tenant_${operation.toLowerCase()}`;
}

exports.up = async function up(knex) {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION auth_company_id() RETURNS INT AS $$
        SELECT NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'company_id', '')::INT
    $$ LANGUAGE sql STABLE;
  `);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION auth_user_id() RETURNS INT AS $$
        SELECT NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::INT
    $$ LANGUAGE sql STABLE;
  `);

  for (const [table, name] of OLD_POLICIES) {
    await knex.raw('DROP POLICY IF EXISTS ?? ON ??;', [name, table]);
  }

  for (const [table, operations] of Object.entries(TENANT_TABLES)) {
    for (const operation of operations) {
      await knex.raw(`CREATE POLICY ?? ON ?? ${newPolicyClause(table, operation)};`, [newPolicyName(operation), table]);
    }
  }
};

exports.down = async function down(knex) {
  for (const [table, operations] of Object.entries(TENANT_TABLES)) {
    for (const operation of operations) {
      await knex.raw('DROP POLICY IF EXISTS ?? ON ??;', [newPolicyName(operation), table]);
    }
  }

  for (const [table, name, clause] of OLD_POLICIES) {
    await knex.raw(`CREATE POLICY ?? ON ?? ${clause};`, [name, table]);
  }

  await knex.raw(`
    CREATE OR REPLACE FUNCTION auth_company_id() RETURNS INT AS $$
        SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'company_id', '')::INT
    $$ LANGUAGE sql STABLE;
  `);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION auth_user_id() RETURNS INT AS $$
        SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::INT
    $$ LANGUAGE sql STABLE;
  `);
};
