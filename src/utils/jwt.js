const jwt = require('jsonwebtoken');
const env = require('../config/env');

function signAccessToken({ userId, companyId, rules, mustChangePassword }) {
  return jwt.sign(
    { sub: userId, company_id: companyId, rules, must_change_password: Boolean(mustChangePassword) },
    env.jwtAccessSecret,
    { expiresIn: env.jwtAccessExpiresIn }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtAccessSecret);
}

module.exports = { signAccessToken, verifyAccessToken };
