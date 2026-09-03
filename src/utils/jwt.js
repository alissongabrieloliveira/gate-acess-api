const jwt = require('jsonwebtoken');
const env = require('../config/env');

function signAccessToken({ userId, companyId, rules }) {
  return jwt.sign(
    { sub: userId, company_id: companyId, rules },
    env.jwtAccessSecret,
    { expiresIn: env.jwtAccessExpiresIn }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtAccessSecret);
}

module.exports = { signAccessToken, verifyAccessToken };
