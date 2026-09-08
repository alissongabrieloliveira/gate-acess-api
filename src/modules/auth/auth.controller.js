const authService = require('./auth.service');
const env = require('../../config/env');

const REFRESH_COOKIE_NAME = 'refresh_token';
// Escopo restrito ao prefixo das rotas de auth: o cookie só precisa trafegar em
// /refresh e /logout, reduzindo a superfície de exposição do token.
const REFRESH_COOKIE_PATH = '/api/v1/auth';

function setRefreshCookie(res, token, expiresAt) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    // 'strict' funciona em dev porque frontend e backend, mesmo em portas
    // diferentes, são "same-site" (mesmo domínio raiz: localhost). Em
    // produção o normal é frontend e backend viverem em domínios raiz
    // DIFERENTES (ex.: app na Vercel, API no Railway) — nesse caso
    // 'strict' faz o navegador nunca enviar o cookie nas chamadas do
    // frontend pro backend, e o refresh (logo a sessão inteira) quebra
    // silenciosamente. 'none' exige 'secure: true' (por isso só em
    // produção, onde 'secure' já é true) — continua seguro contra CSRF
    // porque o cookie é httpOnly e só viaja pro path de auth, e mesmo
    // same-site 'none' não causa problema nenhum (o navegador só deixa de
    // aplicar a restrição extra, que aqui nunca foi a defesa principal).
    sameSite: env.nodeEnv === 'production' ? 'none' : 'strict',
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
    }

    const { accessToken, refreshTokenRaw, refreshExpiresAt } = await authService.login({
      email,
      password,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    setRefreshCookie(res, refreshTokenRaw, refreshExpiresAt);
    return res.status(200).json({ accessToken });
  } catch (err) {
    return next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const refreshTokenRaw = req.cookies?.[REFRESH_COOKIE_NAME];

    const {
      accessToken,
      refreshTokenRaw: newRefreshTokenRaw,
      refreshExpiresAt,
    } = await authService.refresh({
      refreshTokenRaw,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    setRefreshCookie(res, newRefreshTokenRaw, refreshExpiresAt);
    return res.status(200).json({ accessToken });
  } catch (err) {
    clearRefreshCookie(res);
    return next(err);
  }
}

async function logout(req, res, next) {
  try {
    const refreshTokenRaw = req.cookies?.[REFRESH_COOKIE_NAME];
    await authService.logout({ refreshTokenRaw });
    clearRefreshCookie(res);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: 'E-mail é obrigatório' });
    }

    await authService.forgotPassword({ email });
    // Sempre 200 com a mesma mensagem, exista ou não a conta — mesmo
    // princípio anti-enumeração já usado no login.
    return res.status(200).json({ message: 'Se o e-mail informado estiver cadastrado, você receberá as instruções em instantes.' });
  } catch (err) {
    return next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body || {};
    await authService.resetPassword({ token, password });
    return res.status(200).json({ message: 'Senha redefinida com sucesso.' });
  } catch (err) {
    return next(err);
  }
}

module.exports = { login, refresh, logout, forgotPassword, resetPassword };
