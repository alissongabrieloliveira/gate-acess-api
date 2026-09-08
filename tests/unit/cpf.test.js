const { isValidCpf } = require('../../src/utils/cpf');

describe('utils/cpf#isValidCpf', () => {
  test.each([
    ['12345678909', true], // exemplo clássico de CPF válido (formato usado em vários validadores)
    ['123.456.789-09', true], // aceita pontuado, valida só os dígitos
    ['11144477735', true], // mesmo CPF usado no seed de admin (memoria.md)
  ])('%s -> válido', (value, expected) => {
    expect(isValidCpf(value)).toBe(expected);
  });

  test.each([
    ['11122233344', 'dígito verificador incorreto'],
    ['12345678900', 'dígito verificador incorreto'],
    ['11111111111', 'todos os dígitos iguais'],
    ['1234567890', 'menos de 11 dígitos'],
    ['123456789012', 'mais de 11 dígitos'],
    ['', 'vazio'],
    [null, 'null'],
    [undefined, 'undefined'],
  ])('%s -> inválido (%s)', (value) => {
    expect(isValidCpf(value)).toBe(false);
  });
});
