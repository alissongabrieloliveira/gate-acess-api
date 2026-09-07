const { generateBindex } = require('../../src/utils/bindex');

describe('utils/bindex', () => {
  test('mesmo input sempre gera o mesmo hash (determinístico)', () => {
    expect(generateBindex('teste@empresa.com')).toBe(generateBindex('teste@empresa.com'));
  });

  test('normaliza (minúsculas + remove pontuação) antes de gerar o hash', () => {
    expect(generateBindex('123.456.789-00')).toBe(generateBindex('12345678900'));
    expect(generateBindex('Teste@Empresa.com')).toBe(generateBindex('TESTE@EMPRESA.COM'));
  });

  test('inputs diferentes geram hashes diferentes', () => {
    expect(generateBindex('12345678900')).not.toBe(generateBindex('12345678901'));
  });

  test('gera um hex de 64 caracteres (SHA-256)', () => {
    expect(generateBindex('qualquer coisa')).toMatch(/^[0-9a-f]{64}$/);
  });
});
