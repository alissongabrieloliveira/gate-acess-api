const jwt = require('jsonwebtoken');
const { signAccessToken, verifyAccessToken } = require('../../src/utils/jwt');
const env = require('../../src/config/env');

describe('utils/jwt', () => {
  test('sign -> verify preserva as claims', () => {
    const token = signAccessToken({ userId: 7, companyId: 3, rules: 1, mustChangePassword: true });
    const payload = verifyAccessToken(token);

    expect(payload.sub).toBe(7);
    expect(payload.company_id).toBe(3);
    expect(payload.rules).toBe(1);
    expect(payload.must_change_password).toBe(true);
  });

  test('mustChangePassword ausente/falsy vira false na claim (Boolean())', () => {
    const token = signAccessToken({ userId: 1, companyId: 1, rules: 0 });
    const payload = verifyAccessToken(token);
    expect(payload.must_change_password).toBe(false);
  });

  test('token assinado com outra chave é rejeitado', () => {
    const tokenComOutraChave = jwt.sign({ sub: 1, company_id: 1, rules: 0 }, 'chave-errada');
    expect(() => verifyAccessToken(tokenComOutraChave)).toThrow();
  });

  test('token expirado é rejeitado', () => {
    const expiredToken = jwt.sign({ sub: 1, company_id: 1, rules: 0 }, env.jwtAccessSecret, { expiresIn: -10 });
    expect(() => verifyAccessToken(expiredToken)).toThrow();
  });

  test('token adulterado (payload alterado sem re-assinar) é rejeitado', () => {
    const token = signAccessToken({ userId: 1, companyId: 1, rules: 0 });
    const [header, , signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 999, company_id: 1, rules: 1 })).toString('base64url');
    expect(() => verifyAccessToken(`${header}.${forgedPayload}.${signature}`)).toThrow();
  });
});
