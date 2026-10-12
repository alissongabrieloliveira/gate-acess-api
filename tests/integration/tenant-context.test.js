// Claim do tenant em toda consulta (RLS real, etapa 2 — utils/tenantContext.js
// e config/db.js). A API ainda conecta como dona das tabelas, então nada muda
// no comportamento; estes testes garantem que a claim certa chega a cada
// consulta — inclusive leituras, upload (multer) e os fluxos de auth que
// começam sem empresa —, que é o que as policies vão exigir na etapa 4.
jest.mock('../../src/utils/email');
jest.mock('../../src/utils/supabaseStorage', () => ({
  uploadPhoto: jest.fn().mockResolvedValue(undefined),
  deletePhoto: jest.fn().mockResolvedValue(undefined),
  getSignedUrls: jest.fn(async (paths) => new Map(paths.map((p) => [p, `https://storage.test/signed/${p}`]))),
  attachSignedPhotoUrls: jest.fn(async (dtos) => dtos),
}));

const request = require('supertest');
const app = require('../../src/app');
const db = require('../helpers/db');
const { signAccessToken } = require('../../src/utils/jwt');
const { runWithTenant, currentTenantClaims } = require('../../src/utils/tenantContext');
const withAuthTransaction = require('../../src/utils/withAuthTransaction');
const { sendPasswordResetEmail } = require('../../src/utils/email');
const { authHeader, extractCookiePair } = require('../helpers/auth');
const { createCompany, createAdminUser, createPerson } = require('../helpers/factories');
const { authenticateGatewayToken } = require('../../src/gatewayWs/deviceAuth');
const { hashGatewayToken } = require('../../src/utils/gatewayToken');

async function sessionClaims(trx = db) {
  const result = await trx.raw(`SELECT current_setting('request.jwt.claims', true) AS claims`);
  return result.rows[0].claims;
}

function claimsOf(companyId) {
  return JSON.stringify({ company_id: companyId });
}

// Registra a claim do contexto em cada consulta feita pelo knex durante `fn`
// (o evento 'query' dispara no mesmo contexto assíncrono em que a conexão foi
// tirada do pool e recebeu a claim).
let captured = null;
db.on('query', (query) => {
  if (captured) captured.push({ sql: query.sql, claims: currentTenantClaims() });
});

async function queriesDuring(fn) {
  captured = [];
  try {
    await fn();
    return captured;
  } finally {
    captured = null;
  }
}

// Só as funções app_private.* rodam sem empresa: elas é que descobrem a empresa.
function expectAllInCompany(queries, companyId) {
  const tenantQueries = queries.filter((q) => !q.sql.includes('app_private.'));
  expect(tenantQueries.length).toBeGreaterThan(0);
  for (const query of tenantQueries) {
    expect({ sql: query.sql, claims: query.claims }).toEqual({ sql: query.sql, claims: claimsOf(companyId) });
  }
}

describe('Claim do tenant em cada consulta', () => {
  let companyA;
  let companyB;
  let adminA;
  let tokenA;
  let personA;

  beforeAll(async () => {
    companyA = await createCompany();
    companyB = await createCompany();
    adminA = await createAdminUser(companyA.id);
    personA = await createPerson({ companyId: companyA.id });
    tokenA = signAccessToken({ userId: adminA.id, companyId: companyA.id, rules: adminA.rules, mustChangePassword: false });
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('conexão do pool', () => {
    test('fora de contexto, a conexão fica sem claim', async () => {
      await runWithTenant(companyA.id, async () => sessionClaims());
      expect(await sessionClaims()).toBe('');
    });

    test('dentro do contexto, a conexão leva a empresa — e troca quando a empresa muda', async () => {
      expect(await runWithTenant(companyA.id, async () => await sessionClaims())).toBe(claimsOf(companyA.id));
      expect(await runWithTenant(companyB.id, async () => await sessionClaims())).toBe(claimsOf(companyB.id));
    });

    test('requisições simultâneas de empresas diferentes não se misturam', async () => {
      const runs = Array.from({ length: 20 }, (_, i) => {
        const companyId = i % 2 ? companyA.id : companyB.id;
        return runWithTenant(companyId, async () => ({ companyId, claims: await sessionClaims() }));
      });
      for (const { companyId, claims } of await Promise.all(runs)) {
        expect(claims).toBe(claimsOf(companyId));
      }
    });

    test('withAuthTransaction põe o autor (sub) só na transação e a conexão volta à claim da empresa', async () => {
      const auth = { userId: adminA.id, companyId: companyA.id };
      const result = await runWithTenant(companyA.id, async () => {
        let inside;
        let after;
        await db.transaction(async (outer) => {
          await withAuthTransaction(auth, async (trx) => {
            inside = await sessionClaims(trx);
          });
          after = await sessionClaims(outer);
        });
        return { inside: JSON.parse(inside), after };
      });
      expect(result).toEqual({ inside: { sub: adminA.id, company_id: companyA.id }, after: claimsOf(companyA.id) });
    });
  });

  describe('rotas da API', () => {
    test('leitura autenticada (GET /people)', async () => {
      const queries = await queriesDuring(async () => {
        const res = await request(app).get('/api/v1/people').set(authHeader(tokenA));
        expect(res.status).toBe(200);
      });
      expectAllInCompany(queries, companyA.id);
    });

    test('dashboard e alertas', async () => {
      const queries = await queriesDuring(async () => {
        const from = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
        const summary = await request(app).get('/api/v1/dashboard/summary').set(authHeader(tokenA)).query({ from });
        expect(summary.status).toBe(200);
        expect((await request(app).get('/api/v1/dashboard/alerts').set(authHeader(tokenA))).status).toBe(200);
      });
      expectAllInCompany(queries, companyA.id);
    });

    test('upload de foto mantém o tenant até o controller (multer 2 preserva o contexto assíncrono)', async () => {
      const queries = await queriesDuring(async () => {
        const res = await request(app)
          .post(`/api/v1/people/${personA.id}/photo`)
          .set(authHeader(tokenA))
          .attach('photo', Buffer.alloc(3 * 1024 * 1024, 1), { filename: 'foto.png', contentType: 'image/png' });
        expect(res.status).toBe(200);
      });
      expectAllInCompany(queries, companyA.id);
    });

    test('login, refresh e logout rodam na empresa do usuário', async () => {
      let refreshCookie;
      const queries = await queriesDuring(async () => {
        const login = await request(app)
          .post('/api/v1/auth/login')
          .send({ email: adminA.email, password: adminA.rawPassword });
        expect(login.status).toBe(200);
        refreshCookie = extractCookiePair(login.headers['set-cookie'], 'refresh_token');

        const refresh = await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie);
        expect(refresh.status).toBe(200);
        refreshCookie = extractCookiePair(refresh.headers['set-cookie'], 'refresh_token');

        expect((await request(app).post('/api/v1/auth/logout').set('Cookie', refreshCookie)).status).toBe(204);
      });
      expectAllInCompany(queries, companyA.id);
    });

    test('login com e-mail desconhecido continua dando 401, sem consultar com empresa', async () => {
      const queries = await queriesDuring(async () => {
        const res = await request(app).post('/api/v1/auth/login').send({ email: 'ninguem@teste.com', password: 'x' });
        expect(res.status).toBe(401);
      });
      expect(queries.every((q) => q.claims === '')).toBe(true);
    });

    test('esqueci a senha e redefinir senha rodam na empresa do usuário', async () => {
      sendPasswordResetEmail.mockClear();
      const queries = await queriesDuring(async () => {
        expect((await request(app).post('/api/v1/auth/forgot-password').send({ email: adminA.email })).status).toBe(200);
        const token = new URL(sendPasswordResetEmail.mock.calls[0][0].resetUrl).searchParams.get('token');
        const reset = await request(app)
          .post('/api/v1/auth/reset-password')
          .send({ token, password: 'NovaSenhaTeste123!' });
        expect(reset.status).toBe(200);
      });
      expectAllInCompany(queries, companyA.id);
    });
  });

  describe('gateway', () => {
    test('token do gateway resolve o device dentro da empresa dele; token desconhecido = null', async () => {
      const rawToken = `token-gateway-teste-${Date.now()}`;
      const [device] = await db('gateway_devices')
        .insert({ company_id: companyA.id, name: 'Gateway Teste Contexto', token_hash: hashGatewayToken(rawToken) })
        .returning('id');

      let resolved;
      const queries = await queriesDuring(async () => {
        resolved = await authenticateGatewayToken(rawToken);
      });
      expect(resolved).toMatchObject({ id: device.id, company_id: companyA.id });
      expectAllInCompany(queries, companyA.id);

      expect(await authenticateGatewayToken('token-que-nao-existe')).toBeNull();
    });
  });
});
