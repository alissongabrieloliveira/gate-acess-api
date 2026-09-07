const authorize = require('../../src/middlewares/authorize');
const RULES = require('../../src/config/rules');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('middlewares/authorize', () => {
  test('bit de permissão presente -> chama next()', () => {
    const middleware = authorize(RULES.ADMIN);
    const req = { auth: { rules: RULES.ADMIN } };
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('bit de permissão ausente -> 403 "Permissão insuficiente"', () => {
    const middleware = authorize(RULES.ADMIN);
    const req = { auth: { rules: 0 } };
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Permissão insuficiente' });
  });

  test('sem req.auth (authenticate não rodou antes) -> 401', () => {
    const middleware = authorize(RULES.ADMIN);
    const req = {};
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
