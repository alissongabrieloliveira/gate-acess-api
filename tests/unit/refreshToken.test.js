const crypto = require('crypto');
const { generateRefreshToken, hashRefreshToken } = require('../../src/utils/refreshToken');

describe('utils/refreshToken', () => {
  test('gera um raw token e o hash correspondente (SHA-256)', () => {
    const { raw, hash } = generateRefreshToken();
    const expectedHash = crypto.createHash('sha256').update(raw).digest('hex');
    expect(hash).toBe(expectedHash);
  });

  test('hashRefreshToken é determinístico pro mesmo raw', () => {
    const { raw } = generateRefreshToken();
    expect(hashRefreshToken(raw)).toBe(hashRefreshToken(raw));
  });

  test('duas chamadas geram raw tokens diferentes (alta entropia)', () => {
    const first = generateRefreshToken();
    const second = generateRefreshToken();
    expect(first.raw).not.toBe(second.raw);
  });
});
