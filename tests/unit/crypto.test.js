const { encryptField, decryptField } = require('../../src/utils/crypto');

describe('utils/crypto', () => {
  test('encryptField -> decryptField preserva o texto original', () => {
    const plaintext = 'João da Silva 123.456.789-00';
    const encrypted = encryptField(plaintext);
    expect(decryptField(encrypted)).toBe(plaintext);
  });

  test('duas chamadas com o mesmo texto geram ciphertexts diferentes (IV aleatório)', () => {
    const plaintext = 'mesmo texto';
    const first = encryptField(plaintext);
    const second = encryptField(plaintext);
    expect(first).not.toBe(second);
    expect(decryptField(first)).toBe(plaintext);
    expect(decryptField(second)).toBe(plaintext);
  });

  test('null/undefined passam direto, sem cifrar', () => {
    expect(encryptField(null)).toBeNull();
    expect(encryptField(undefined)).toBeNull();
    expect(decryptField(null)).toBeNull();
    expect(decryptField(undefined)).toBeNull();
  });

  test('payload corrompido/adulterado falha na decriptação (auth tag do GCM)', () => {
    const encrypted = encryptField('dado sensível');
    const buffer = Buffer.from(encrypted, 'base64');
    buffer[buffer.length - 1] ^= 0xff; // vira 1 bit do ciphertext
    const tampered = buffer.toString('base64');
    expect(() => decryptField(tampered)).toThrow();
  });
});
