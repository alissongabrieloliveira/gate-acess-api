const authenticate = require('../../src/middlewares/authenticate');
const { signAccessToken } = require('../../src/utils/jwt');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('middlewares/authenticate', () => {
  test('token válido popula req.auth e chama next()', () => {
    const token = signAccessToken({ userId: 5, companyId: 2, rules: 1, mustChangePassword: false });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth).toEqual({ userId: 5, companyId: 2, rules: 1, mustChangePassword: false });
    expect(res.status).not.toHaveBeenCalled();
  });

  test('sem header Authorization -> 401, next() não é chamado', () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('header sem o esquema "Bearer" -> 401', () => {
    const token = signAccessToken({ userId: 1, companyId: 1, rules: 0 });
    const req = { headers: { authorization: `Token ${token}` } };
    const res = mockRes();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('token malformado/inválido -> 401', () => {
    const req = { headers: { authorization: 'Bearer token-invalido' } };
    const res = mockRes();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
