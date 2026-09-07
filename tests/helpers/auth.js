// Atalhos pra autenticar contra a app real via supertest.
function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

// Login de verdade via POST /auth/login — usado quando o próprio fluxo de
// login é o que está sob teste (tests/integration/auth.test.js). Nos demais
// arquivos de integração, autenticação é só um pré-requisito pro que
// realmente está sendo testado — ali é mais rápido assinar o JWT direto
// (utils/jwt.js signAccessToken), sem reexercitar bcrypt/rate-limit a cada
// teste.
// Extrai só o par "nome=valor" do Set-Cookie (descarta Path/HttpOnly/
// SameSite/Expires) — é isso que um Cookie de requisição de verdade contém.
function extractCookiePair(setCookieHeader, cookieName) {
  const setCookie = setCookieHeader ?? [];
  const full = setCookie.find((cookie) => cookie.startsWith(`${cookieName}=`));
  return full ? full.split(';')[0] : null;
}

async function loginAndGetTokens(app, request, email, password) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  const refreshCookie = extractCookiePair(res.headers['set-cookie'], 'refresh_token');
  return { status: res.status, body: res.body, accessToken: res.body?.accessToken, refreshCookie };
}

module.exports = { authHeader, loginAndGetTokens, extractCookiePair };
