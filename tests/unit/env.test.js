// Segredos fortes e distintos dos valores de .env.test, usados em testes
// que ligam NODE_ENV=production — desde que a validação do item 3 da
// auditoria (força mínima + bloqueio de valores de teste conhecidos) existe,
// simplesmente setar NODE_ENV=production não basta mais: os segredos
// herdados de .env.test (carregados por tests/setupEnv.js) seriam
// rejeitados por serem os valores de teste conhecidos.
const SAFE_SECRET = 'z'.repeat(40);
const SAFE_FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const SAFE_SUPABASE_KEY = 'safe-service-role-key-nao-e-de-teste';
const KNOWN_TEST_VALUES = {
  JWT_ACCESS_SECRET: 'test-only-access-secret-nao-usar-em-producao',
  BINDEX_PEPPER: 'test-only-bindex-pepper-nao-usar-em-producao',
  FIELD_ENCRYPTION_KEY: '6egsnHgAeZcxqwOyLGfN8j0Bw1vhiG38NQZ9nEQO2QI=',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only-fake-service-role-key',
};

// Regressão pro item da auditoria "NODE_ENV=production não setado": um
// valor SETADO mas digitado errado (ex.: "prod" em vez de "production")
// fazia `nodeEnv === 'production'` falhar silenciosamente, desligando o
// `secure` do cookie de refresh sem nenhum aviso. config/env.js agora
// valida contra uma lista fechada de valores — este teste trava isso.
describe('config/env — validação de NODE_ENV', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalJwtSecret = process.env.JWT_ACCESS_SECRET;
  const originalBindexPepper = process.env.BINDEX_PEPPER;
  const originalFieldEncryptionKey = process.env.FIELD_ENCRYPTION_KEY;
  const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.JWT_ACCESS_SECRET = originalJwtSecret;
    process.env.BINDEX_PEPPER = originalBindexPepper;
    process.env.FIELD_ENCRYPTION_KEY = originalFieldEncryptionKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
    jest.resetModules();
  });

  test.each(['development', 'test', 'production'])('aceita "%s"', (value) => {
    process.env.NODE_ENV = value;
    // Só entra em jogo quando value === 'production': fora disso os
    // segredos de .env.test já são aceitos normalmente (ver comentário no
    // topo do arquivo).
    process.env.JWT_ACCESS_SECRET = SAFE_SECRET;
    process.env.BINDEX_PEPPER = SAFE_SECRET;
    process.env.FIELD_ENCRYPTION_KEY = SAFE_FIELD_ENCRYPTION_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SAFE_SUPABASE_KEY;
    jest.resetModules();
    expect(() => require('../../src/config/env')).not.toThrow();
  });

  test.each(['prod', 'Production', 'PRODUCTION', 'producton'])(
    'rejeita valor digitado errado: "%s"',
    (value) => {
      process.env.NODE_ENV = value;
      jest.resetModules();
      expect(() => require('../../src/config/env')).toThrow(/NODE_ENV inválido/);
    }
  );

  test('NODE_ENV vazio cai no default "development" sem lançar', () => {
    // String vazia, não delete: env.js chama `dotenv.config()` sem path (lê
    // o `.env` de verdade do host) a cada `require` fresco — dotenv só
    // preenche uma variável ausente de process.env, não uma já presente
    // como string vazia, então isso simula "não setado" de forma confiável
    // independente do que o `.env` real da máquina tiver (`delete`
    // deixaria o dotenv repopular a partir dele, mascarando o teste).
    process.env.NODE_ENV = '';
    jest.resetModules();
    expect(require('../../src/config/env').nodeEnv).toBe('development');
  });
});

// Regressão pro item da auditoria "CORS_ORIGIN cai silenciosamente pra
// localhost": em produção isso rejeita o frontend real por CORS E faz o
// link de "esqueci minha senha" apontar pra localhost — os dois só
// visíveis em produção, não em dev. config/env.js agora exige a variável
// explicitamente quando NODE_ENV=production.
describe('config/env — CORS_ORIGIN obrigatório em produção', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalCorsOrigin = process.env.CORS_ORIGIN;
  const originalJwtSecret = process.env.JWT_ACCESS_SECRET;
  const originalBindexPepper = process.env.BINDEX_PEPPER;
  const originalFieldEncryptionKey = process.env.FIELD_ENCRYPTION_KEY;
  const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.CORS_ORIGIN = originalCorsOrigin;
    process.env.JWT_ACCESS_SECRET = originalJwtSecret;
    process.env.BINDEX_PEPPER = originalBindexPepper;
    process.env.FIELD_ENCRYPTION_KEY = originalFieldEncryptionKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
    jest.resetModules();
  });

  test('NODE_ENV=production sem CORS_ORIGIN -> recusa subir', () => {
    process.env.NODE_ENV = 'production';
    // String vazia, não delete: env.js chama `dotenv.config()` sem path (lê
    // o `.env` de verdade) a cada `require` fresco — dotenv só preenche uma
    // variável que esteja ausente de process.env, não uma já presente
    // como string vazia, então isso simula "não configurado" de forma
    // confiável (delete deixaria o dotenv repopular com o valor do .env
    // real do host, mascarando o teste).
    process.env.CORS_ORIGIN = '';
    jest.resetModules();
    expect(() => require('../../src/config/env')).toThrow(/CORS_ORIGIN é obrigatório/);
  });

  test('NODE_ENV=production com CORS_ORIGIN setado -> sobe normalmente', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://app.exemplo.com';
    process.env.JWT_ACCESS_SECRET = SAFE_SECRET;
    process.env.BINDEX_PEPPER = SAFE_SECRET;
    process.env.FIELD_ENCRYPTION_KEY = SAFE_FIELD_ENCRYPTION_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SAFE_SUPABASE_KEY;
    jest.resetModules();
    expect(() => require('../../src/config/env')).not.toThrow();
    expect(require('../../src/config/env').corsOrigin).toBe('https://app.exemplo.com');
  });

  test('fora de produção, sem CORS_ORIGIN, cai no fallback de localhost sem lançar', () => {
    process.env.NODE_ENV = 'development';
    process.env.CORS_ORIGIN = ''; // ver comentário no teste acima
    jest.resetModules();
    expect(require('../../src/config/env').corsOrigin).toBe('http://localhost:5173');
  });
});

// Regressão pro item da auditoria "segredos são os de desenvolvimento": um
// JWT_ACCESS_SECRET/BINDEX_PEPPER curto ou previsível (ex.: "changeme")
// nunca deveria conseguir subir a API, em nenhum ambiente.
describe('config/env — força mínima de segredos (JWT_ACCESS_SECRET, BINDEX_PEPPER)', () => {
  const originalJwtSecret = process.env.JWT_ACCESS_SECRET;
  const originalBindexPepper = process.env.BINDEX_PEPPER;

  afterEach(() => {
    process.env.JWT_ACCESS_SECRET = originalJwtSecret;
    process.env.BINDEX_PEPPER = originalBindexPepper;
    jest.resetModules();
  });

  test('JWT_ACCESS_SECRET com menos de 32 caracteres -> recusa subir', () => {
    process.env.JWT_ACCESS_SECRET = 'curto-demais';
    jest.resetModules();
    expect(() => require('../../src/config/env')).toThrow(/JWT_ACCESS_SECRET é fraco demais/);
  });

  test('BINDEX_PEPPER com menos de 32 caracteres -> recusa subir', () => {
    process.env.BINDEX_PEPPER = 'curto-demais';
    jest.resetModules();
    expect(() => require('../../src/config/env')).toThrow(/BINDEX_PEPPER é fraco demais/);
  });

  test('segredo com exatamente 32 caracteres é aceito', () => {
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
    process.env.BINDEX_PEPPER = 'b'.repeat(32);
    jest.resetModules();
    expect(() => require('../../src/config/env')).not.toThrow();
  });
});

// Regressão pro item da auditoria "segredos são os de desenvolvimento": os
// valores de .env.test são públicos no histórico do git (commitados de
// propósito, ver tests/setupEnv.js) — usá-los em produção seria expor a
// "chave secreta" pra qualquer um com acesso ao repositório. Bloqueado só
// em produção; em dev/test são exatamente os valores esperados (é assim
// que a suíte de testes roda).
describe('config/env — bloqueia valores de teste conhecidos em produção', () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    BINDEX_PEPPER: process.env.BINDEX_PEPPER,
    FIELD_ENCRYPTION_KEY: process.env.FIELD_ENCRYPTION_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://app.exemplo.com';
    process.env.JWT_ACCESS_SECRET = SAFE_SECRET;
    process.env.BINDEX_PEPPER = SAFE_SECRET;
    process.env.FIELD_ENCRYPTION_KEY = SAFE_FIELD_ENCRYPTION_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SAFE_SUPABASE_KEY;
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
    jest.resetModules();
  });

  test.each(Object.keys(KNOWN_TEST_VALUES))(
    'NODE_ENV=production com %s igual ao valor de .env.test -> recusa subir',
    (varName) => {
      process.env[varName] = KNOWN_TEST_VALUES[varName];
      jest.resetModules();
      expect(() => require('../../src/config/env')).toThrow(/valor de teste commitado em \.env\.test/);
    }
  );

  test('fora de produção, os valores de .env.test são aceitos normalmente', () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_ACCESS_SECRET = KNOWN_TEST_VALUES.JWT_ACCESS_SECRET;
    process.env.BINDEX_PEPPER = KNOWN_TEST_VALUES.BINDEX_PEPPER;
    process.env.FIELD_ENCRYPTION_KEY = KNOWN_TEST_VALUES.FIELD_ENCRYPTION_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = KNOWN_TEST_VALUES.SUPABASE_SERVICE_ROLE_KEY;
    jest.resetModules();
    expect(() => require('../../src/config/env')).not.toThrow();
  });
});

// Regressão pro item da auditoria "sem observabilidade": um LOG_LEVEL
// digitado errado (ex.: "verbose", que não é um nível do pino) só falharia
// dentro do pino na hora de logar, não no boot — "cadê os logs?" sem
// nenhuma pista do motivo. config/env.js agora valida contra uma lista
// fechada, igual ao padrão já usado pro NODE_ENV.
describe('config/env — validação de LOG_LEVEL', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLogLevel = process.env.LOG_LEVEL;
  const originalCorsOrigin = process.env.CORS_ORIGIN;
  const originalJwtSecret = process.env.JWT_ACCESS_SECRET;
  const originalBindexPepper = process.env.BINDEX_PEPPER;
  const originalFieldEncryptionKey = process.env.FIELD_ENCRYPTION_KEY;
  const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.LOG_LEVEL = originalLogLevel;
    process.env.CORS_ORIGIN = originalCorsOrigin;
    process.env.JWT_ACCESS_SECRET = originalJwtSecret;
    process.env.BINDEX_PEPPER = originalBindexPepper;
    process.env.FIELD_ENCRYPTION_KEY = originalFieldEncryptionKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
    jest.resetModules();
  });

  test.each(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])('aceita "%s"', (value) => {
    process.env.LOG_LEVEL = value;
    jest.resetModules();
    expect(() => require('../../src/config/env')).not.toThrow();
    expect(require('../../src/config/env').logLevel).toBe(value);
  });

  test('rejeita valor inválido: "verbose"', () => {
    process.env.LOG_LEVEL = 'verbose';
    jest.resetModules();
    expect(() => require('../../src/config/env')).toThrow(/LOG_LEVEL inválido/);
  });

  test('sem LOG_LEVEL, fora de produção cai no default "debug"', () => {
    process.env.NODE_ENV = 'development';
    process.env.LOG_LEVEL = ''; // ver comentário nos testes de CORS_ORIGIN sobre dotenv
    jest.resetModules();
    expect(require('../../src/config/env').logLevel).toBe('debug');
  });

  test('sem LOG_LEVEL, em produção cai no default "info"', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = '';
    // Ligar produção também aciona as validações dos itens 1-3 — precisam
    // de valores válidos aqui pra isolar só a checagem de LOG_LEVEL.
    process.env.CORS_ORIGIN = 'https://app.exemplo.com';
    process.env.JWT_ACCESS_SECRET = SAFE_SECRET;
    process.env.BINDEX_PEPPER = SAFE_SECRET;
    process.env.FIELD_ENCRYPTION_KEY = SAFE_FIELD_ENCRYPTION_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SAFE_SUPABASE_KEY;
    jest.resetModules();
    expect(require('../../src/config/env').logLevel).toBe('info');
  });
});
