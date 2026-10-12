// Policies de RLS (migration 20261012130000). A API ainda conecta como dono das
// tabelas, que ignora RLS (claude.md seção 5.5) — então estes testes trocam,
// dentro de cada transação, para um papel sem ser dono (`rls_probe`) e
// verificam o que as policies deixam ou não fazer. É o comportamento que a
// aplicação terá quando passar a conectar com um papel próprio.
const crypto = require('crypto');
const db = require('../helpers/db');
const {
  createCompany,
  createAdminUser,
  createRegularUser,
  createPerson,
  createGate,
} = require('../helpers/factories');

const PROBE_ROLE = 'rls_probe';

// Roda `fn` como `rls_probe`, com a claim da empresa (ou sem claim), e sempre
// desfaz a transação no fim — nada do que o teste grava fica no banco.
async function asTenant(claims, fn) {
  const trx = await db.transaction();
  try {
    if (claims) {
      await trx.raw(`SELECT set_config('request.jwt.claims', ?, true)`, [JSON.stringify(claims)]);
    }
    await trx.raw(`SET LOCAL ROLE ${PROBE_ROLE}`);
    return await fn(trx);
  } finally {
    await trx.rollback();
  }
}

async function insertGatewayDevice(companyId) {
  const [device] = await db('gateway_devices')
    .insert({ company_id: companyId, name: 'Gateway Teste RLS', token_hash: crypto.randomBytes(32).toString('hex') })
    .returning('*');
  const [output] = await db('gate_direction_outputs')
    .insert({
      company_id: companyId,
      gateway_device_id: device.id,
      direction: 'ENTRY',
      output_number: 1,
      host: '127.0.0.1',
      port: 5000,
      ns: '00000',
    })
    .returning('*');
  return { device, output };
}

describe('Policies de RLS (papel sem ser dono das tabelas)', () => {
  let companyA;
  let companyB;
  let adminA;
  let operatorA;
  let adminB;
  let personA;
  let personB;
  let deletedPersonA;
  let gateB;
  let gatewayA;
  let gatewayB;
  let claimsA;

  beforeAll(async () => {
    await db.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PROBE_ROLE}') THEN
          CREATE ROLE ${PROBE_ROLE} NOLOGIN;
        END IF;
      END
      $$;
    `);
    await db.raw(`GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}`);
    await db.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${PROBE_ROLE}`);
    await db.raw(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${PROBE_ROLE}`);

    companyA = await createCompany();
    companyB = await createCompany();
    adminA = await createAdminUser(companyA.id);
    operatorA = await createRegularUser(companyA.id);
    adminB = await createAdminUser(companyB.id);
    personA = await createPerson({ companyId: companyA.id });
    personB = await createPerson({ companyId: companyB.id });
    deletedPersonA = await createPerson({ companyId: companyA.id });
    await db('people').where({ id: deletedPersonA.id }).update({ deleted_at: db.fn.now() });
    await createGate({ companyId: companyA.id });
    gateB = await createGate({ companyId: companyB.id });
    gatewayA = await insertGatewayDevice(companyA.id);
    gatewayB = await insertGatewayDevice(companyB.id);

    claimsA = { sub: adminA.id, company_id: companyA.id };
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('sem claim, não enxerga nenhuma linha', async () => {
    const rows = await asTenant(null, (trx) => trx('people').whereIn('id', [personA.id, personB.id]));
    expect(rows).toHaveLength(0);
  });

  test('claim vazia (conexão reaproveitada do pool) vira "sem claim", sem erro', async () => {
    const row = await asTenant(null, async (trx) => {
      await trx.raw(`SELECT set_config('request.jwt.claims', '', true)`);
      const result = await trx.raw('SELECT auth_company_id() AS company_id, auth_user_id() AS user_id');
      return result.rows[0];
    });
    expect(row).toEqual({ company_id: null, user_id: null });
  });

  test('com claim, só enxerga a própria empresa — inclusive registros excluídos (soft delete)', async () => {
    const ids = await asTenant(claimsA, (trx) =>
      trx('people').whereIn('id', [personA.id, personB.id, deletedPersonA.id]).pluck('id')
    );
    expect(ids.sort()).toEqual([personA.id, deletedPersonA.id].sort());
  });

  test('não grava linha com company_id de outra empresa', async () => {
    await expect(
      asTenant(claimsA, (trx) => trx('gates').insert({ company_id: companyB.id, name: 'Portão Intruso' }))
    ).rejects.toThrow(/row-level security/);
  });

  test('não altera linha de outra empresa (0 linhas afetadas)', async () => {
    const count = await asTenant(claimsA, (trx) => trx('gates').where({ id: gateB.id }).update({ description: 'x' }));
    expect(count).toBe(0);
  });

  test('não move uma linha própria para outra empresa', async () => {
    await expect(
      asTenant(claimsA, (trx) => trx('people').where({ id: personA.id }).update({ company_id: companyB.id }))
    ).rejects.toThrow(/row-level security/);
  });

  test('soft delete com RETURNING funciona', async () => {
    const rows = await asTenant(claimsA, (trx) =>
      trx('people').where({ id: personA.id }).update({ deleted_at: trx.fn.now() }).returning('id')
    );
    expect(rows).toEqual([{ id: personA.id }]);
  });

  test('admin altera outro operador da mesma empresa, mas não de outra', async () => {
    const result = await asTenant(claimsA, async (trx) => ({
      own: await trx('users').where({ id: operatorA.id }).update({ is_active: false }),
      other: await trx('users').where({ id: adminB.id }).update({ is_active: false }),
    }));
    expect(result).toEqual({ own: 1, other: 0 });
  });

  test('grava login_logs da própria empresa, não de outra', async () => {
    await asTenant(claimsA, (trx) => trx('login_logs').insert({ company_id: companyA.id, user_id: adminA.id }));
    await expect(
      asTenant(claimsA, (trx) => trx('login_logs').insert({ company_id: companyB.id, user_id: adminB.id }))
    ).rejects.toThrow(/row-level security/);
  });

  test('auditoria: trigger continua gravando e a anonimização consegue atualizar a trilha', async () => {
    const updated = await asTenant(claimsA, async (trx) => {
      await trx('gates').insert({ company_id: companyA.id, name: 'Portão Auditado RLS' });
      return trx('audit_logs').where({ company_id: companyA.id, table_name: 'gates' }).update({ old_data: null });
    });
    expect(updated).toBeGreaterThan(0);
  });

  test('tabelas de token e gateway só mostram a própria empresa', async () => {
    const ids = await asTenant(claimsA, (trx) =>
      trx('gateway_devices').whereIn('id', [gatewayA.device.id, gatewayB.device.id]).pluck('id')
    );
    expect(ids).toEqual([gatewayA.device.id]);
  });

  test('saída de cancela pode ser excluída só na própria empresa', async () => {
    const result = await asTenant(claimsA, async (trx) => ({
      own: await trx('gate_direction_outputs').where({ id: gatewayA.output.id }).del(),
      other: await trx('gate_direction_outputs').where({ id: gatewayB.output.id }).del(),
    }));
    expect(result).toEqual({ own: 1, other: 0 });
  });

  test('companies: só a própria empresa', async () => {
    const ids = await asTenant(claimsA, (trx) => trx('companies').whereIn('id', [companyA.id, companyB.id]).pluck('id'));
    expect(ids).toEqual([companyA.id]);
  });

  test('cities continua legível com claim', async () => {
    const row = await asTenant(claimsA, (trx) => trx('cities').first('id'));
    expect(row).toBeDefined();
  });
});
