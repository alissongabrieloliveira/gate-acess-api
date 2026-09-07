const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000; // 15 minutos
const TOO_MANY_REQUESTS_MESSAGE = 'Muitas tentativas. Tente novamente mais tarde.';

// Resposta no mesmo formato { error } usado pelo resto da API
// (errorHandler.js) — o express-rate-limit responde direto (não passa pelo
// errorHandler), então o handler customizado replica o formato aqui.
function tooManyRequestsHandler(req, res) {
  res.status(429).json({ error: TOO_MANY_REQUESTS_MESSAGE });
}

// Limite geral, aplicado em toda a API (defesa base contra abuso/DoS).
//
// AJUSTE (achado real de uso): 300/15min por IP estava baixo demais pro
// padrão de tráfego deste app e acabava sendo atingido só de navegar
// normalmente — cada tela busca vários "lookups" em paralelo (people,
// vehicles, gates, contagens por status...), então trocar entre
// Dashboard/Controle de Acessos/Controle de Frota algumas vezes já soma
// dezenas de requisições, e uma portaria de verdade costuma ter vários
// tablets/operadores atrás do mesmo IP da rede local, dividindo essa
// mesma cota. Como esse limitador é só uma rede de segurança genérica
// contra tráfego anormal (não é a defesa contra força bruta — essa fica
// com os limitadores de login abaixo, que continuam apertados), o número
// certo aqui é bem mais alto: generoso o bastante pra nunca interferir no
// uso normal, mesmo pesado e com vários dispositivos, e só contém picos
// claramente fora do padrão (uma varredura/flood de requisições).
const apiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 3000,
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
// no banco (mesmo tratamento em qualquer um dos dois casos). Reaproveitado
// por loginEmailLimiter e forgotPasswordLimiter abaixo — mesma lógica de
// chave pros dois.
function emailKey(req) {
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
  keyGenerator: emailKey,
  handler: tooManyRequestsHandler,
});

// Diferente do login, aqui TODA tentativa conta (não só falhas) — não tem
// "senha errada" nesse endpoint pra distinguir sucesso de falha, e o
// objetivo é proteger a caixa de entrada de alguém de ser inundada de
// e-mails de recuperação, não detectar força bruta de senha.
const forgotPasswordLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: emailKey,
  handler: tooManyRequestsHandler,
});

// Refresh token já é aleatório de alta entropia (não é adivinhável por
// força bruta) — este limite é só higiene contra abuso/DoS no endpoint,
// não proteção contra brute force.
//
// AJUSTE (mesmo achado do apiLimiter acima): 60/15min por IP também
// esbarrava em uso normal — o access token dura só 15min
// (JWT_ACCESS_EXPIRES_IN), então cada aba recarregada ou cada expiração de
// token durante o turno dispara um /auth/refresh sozinho, e de novo
// vários tablets/operadores no mesmo IP dividem essa cota. Levantado pro
// mesmo espírito do apiLimiter: generoso o bastante pra nunca travar
// recarregamento/uso normal, ainda com um teto contra abuso de verdade.
const refreshLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequestsHandler,
});

module.exports = { apiLimiter, loginIpLimiter, loginEmailLimiter, refreshLimiter, forgotPasswordLimiter };
