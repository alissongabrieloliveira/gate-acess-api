// Regressão pro item da auditoria "NODE_ENV=production não setado": um
// valor SETADO mas digitado errado (ex.: "prod" em vez de "production")
// fazia `nodeEnv === 'production'` falhar silenciosamente, desligando o
// `secure` do cookie de refresh sem nenhum aviso. config/env.js agora
// valida contra uma lista fechada de valores — este teste trava isso.
describe('config/env — validação de NODE_ENV', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.resetModules();
  });

  test.each(['development', 'test', 'production'])('aceita "%s"', (value) => {
    process.env.NODE_ENV = value;
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

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.CORS_ORIGIN = originalCorsOrigin;
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
