const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000; // 15 minutos
const TOO_MANY_REQUESTS_MESSAGE = 'Muitas tentativas. Tente novamente mais tarde.';

// Resposta no mesmo formato { error } usado pelo resto da API
// (errorHandler.js) — o express-rate-limit responde direto (não passa pelo
// errorHandler), então o handler customizado replica o formato aqui.
function tooManyRequestsHandler(req, res) {
  res.status(429).json({ error: TOO_MANY_REQUESTS_MESSAGE });
}

// Limite geral, aplicado em toda a API (defesa base contra abuso/DoS) —
// generoso o bastante pra não atrapalhar uso normal do app (várias telas
// buscando lookups em paralelo), só contém volume anormal.
const apiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequestsHandler,
});

// Por IP: pega força bruta de origem única (um atacante testando muitas
// senhas, ou testando várias contas a partir do mesmo IP). Só tentativas
// que falham contam (skipSuccessfulRequests) — um usuário legítimo que
// erra a senha uma ou duas vezes antes de acertar não é penalizado.
const loginIpLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: tooManyRequestsHandler,
});

// Por e-mail (não por IP): um limitador só por IP não pega força bruta
// distribuída (várias origens/IPs diferentes testando senhas contra a
// MESMA conta) — esse limitador fecha essa lacuna, contando tentativas
// pelo e-mail digitado, independente de onde vieram. Mesmo critério de
// "só conta falha" do limitador por IP. Não vaza informação de
// enumeração: a chave é o texto digitado, não se o e-mail existe de fato
// no banco (mesmo tratamento em qualquer um dos dois casos).
function loginEmailKey(req) {
  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase();
  // Sem e-mail no corpo: cai de volta pro IP — precisa do helper da
  // biblioteca (não usar req.ip cru) pra normalizar IPv6 corretamente,
  // senão um atacante em IPv6 poderia variar o final do endereço pra
  // burlar o limite.
  return email || ipKeyGenerator(req.ip);
}

const loginEmailLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: loginEmailKey,
  handler: tooManyRequestsHandler,
});

// Refresh token já é aleatório de alta entropia (não é adivinhável por
// força bruta) — este limite é só higiene contra abuso/DoS no endpoint,
// não proteção contra brute force.
const refreshLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequestsHandler,
});

module.exports = { apiLimiter, loginIpLimiter, loginEmailLimiter, refreshLimiter };
