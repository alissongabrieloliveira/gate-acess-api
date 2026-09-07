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

  test('sem NODE_ENV setado (ou string vazia), cai no default "development" sem lançar', () => {
    delete process.env.NODE_ENV;
    jest.resetModules();
    expect(require('../../src/config/env').nodeEnv).toBe('development');

    process.env.NODE_ENV = '';
    jest.resetModules();
    expect(require('../../src/config/env').nodeEnv).toBe('development');
  });
});
