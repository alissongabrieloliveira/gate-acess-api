require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

// Sem NODE_ENV setado, o padrão continua "development" (mesma convenção do
// Node/do ecossistema — a falha mais segura, já que "esquecer de setar"
// nunca deveria LIGAR hardening de produção por acidente num ambiente que
// o desenvolvedor acha que é local). O que essa validação pega é o erro
// oposto e mais perigoso: um valor SETADO mas digitado errado (ex.: "prod"
// em vez de "production", ou "Production" com maiúscula) — sem essa
// checagem, `nodeEnv === 'production'` (usado pra decidir o `secure` do
// cookie de refresh em auth.controller.js) falha silenciosamente pra
// "false", e o cookie de sessão sai sem exigir HTTPS em produção, sem
// nenhum aviso de que algo está errado.
const VALID_NODE_ENVS = ['development', 'test', 'production'];
const nodeEnv = process.env.NODE_ENV || 'development';
if (!VALID_NODE_ENVS.includes(nodeEnv)) {
  throw new Error(
    `NODE_ENV inválido: "${nodeEnv}" — use exatamente um de: ${VALID_NODE_ENVS.join(', ')}. ` +
      'Um valor errado aqui (ex.: "prod" em vez de "production") faz recursos de segurança que dependem ' +
      'dele (cookie de refresh com "secure") ficarem desligados sem nenhum aviso.'
  );
}

// CORS_ORIGIN cai num fallback de desenvolvimento (localhost:5173) quando
// não setado — conveniente pra rodar local sem configurar nada, mas
// perigoso em produção: a API sobe normalmente, só que rejeita (por CORS)
// toda requisição vinda do domínio real do frontend, e o link de
// recuperação de senha (auth.service.js#forgotPassword, que reaproveita
// esta mesma variável) sai apontando pra localhost em vez do domínio de
// verdade — os dois com erro só visível em produção, não em dev. Exigido
// explicitamente só quando NODE_ENV=production; em development/test o
// fallback continua valendo, sem precisar configurar nada pra rodar local.
if (nodeEnv === 'production' && !process.env.CORS_ORIGIN) {
  throw new Error(
    'CORS_ORIGIN é obrigatório com NODE_ENV=production — sem ele a API cai no fallback de ' +
      'desenvolvimento (http://localhost:5173): o frontend real é bloqueado por CORS, e o link de ' +
      'recuperação de senha sai apontando pra localhost.'
  );
}

// Estes são os valores EXATOS commitados em backend/.env.test — públicos no
// histórico do git de propósito, já que são só pra teste (ver
// tests/setupEnv.js). Usar qualquer um deles em produção seria uma falha de
// segurança crítica e silenciosa: qualquer pessoa com acesso ao repositório
// já teria a "chave secreta". Bloqueado só em produção — em dev/test são
// exatamente os valores esperados.
const KNOWN_TEST_VALUES = {
  JWT_ACCESS_SECRET: 'test-only-access-secret-nao-usar-em-producao',
  BINDEX_PEPPER: 'test-only-bindex-pepper-nao-usar-em-producao',
  FIELD_ENCRYPTION_KEY: '6egsnHgAeZcxqwOyLGfN8j0Bw1vhiG38NQZ9nEQO2QI=',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only-fake-service-role-key',
};

function assertNotKnownTestValue(name, value) {
  if (nodeEnv === 'production' && value === KNOWN_TEST_VALUES[name]) {
    throw new Error(
      `${name} está usando o valor de teste commitado em .env.test (público no histórico do git) — ` +
        'isso é uma falha crítica de segurança em produção. Gere um valor novo, real, fora do controle de versão.'
    );
  }
}

// Pega segredo curto/previsível (ex.: "secret123", "changeme") em qualquer
// ambiente — os segredos de dev já configurados neste projeto têm 64
// caracteres, bem acima do mínimo, então isso nunca deveria incomodar um
// setup legítimo.
const MIN_SECRET_LENGTH = 32;
function assertMinLength(name, value) {
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} é fraco demais (${value.length} caracteres, mínimo ${MIN_SECRET_LENGTH}) — gere um valor ` +
        'novo com entropia real (ex.: `openssl rand -base64 32`), nunca um valor curto ou previsível.'
    );
  }
}

const jwtAccessSecret = required('JWT_ACCESS_SECRET');
assertMinLength('JWT_ACCESS_SECRET', jwtAccessSecret);
assertNotKnownTestValue('JWT_ACCESS_SECRET', jwtAccessSecret);

const bindexPepper = required('BINDEX_PEPPER');
assertMinLength('BINDEX_PEPPER', bindexPepper);
assertNotKnownTestValue('BINDEX_PEPPER', bindexPepper);

const fieldEncryptionKeyRaw = required('FIELD_ENCRYPTION_KEY');
assertNotKnownTestValue('FIELD_ENCRYPTION_KEY', fieldEncryptionKeyRaw);
const fieldEncryptionKey = Buffer.from(fieldEncryptionKeyRaw, 'base64');
if (fieldEncryptionKey.length !== 32) {
  throw new Error('FIELD_ENCRYPTION_KEY deve decodificar (base64) para exatamente 32 bytes');
}

const supabaseServiceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
assertNotKnownTestValue('SUPABASE_SERVICE_ROLE_KEY', supabaseServiceRoleKey);

// Sem LOG_LEVEL setado, o default já varia com o ambiente: 'debug' fora de
// produção (log verboso sem precisar configurar nada pra rodar local) e
// 'info' em produção (não polui o log de produção com detalhe de debug).
// Um valor SETADO mas digitado errado (ex.: "verbose", que não é um nível
// do pino) só falharia dentro do `pino` na hora de logar, não no boot —
// "cadê os logs?" sem nenhuma pista do motivo. Validado aqui, cedo,
// com uma mensagem que já aponta a causa.
const VALID_LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
const logLevel = process.env.LOG_LEVEL || (nodeEnv === 'production' ? 'info' : 'debug');
if (!VALID_LOG_LEVELS.includes(logLevel)) {
  throw new Error(
    `LOG_LEVEL inválido: "${logLevel}" — use exatamente um de: ${VALID_LOG_LEVELS.join(', ')}.`
  );
}

module.exports = {
  nodeEnv,
  port: Number(process.env.PORT) || 3333,
  databaseUrl: required('DATABASE_URL'),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  jwtAccessSecret,
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  refreshTokenExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

  fieldEncryptionKey,
  // Deve ser o mesmo valor configurado em `app.bindex_pepper` no Postgres
  // (ALTER DATABASE ... SET app.bindex_pepper = '...'), já que o blind index é
  // gerado aqui no Node (ver src/utils/bindex.js) para evitar um round-trip
  // extra ao banco só para calcular o hash de busca.
  bindexPepper,

  // Fotos de people/vehicles vivem no Supabase Storage (ver
  // src/utils/supabaseStorage.js) — sem fallback em disco local, por isso
  // são obrigatórias: sem elas a app não tem como servir/receber foto
  // nenhuma. Service Role Key (não a anon/public) — precisa bypassar RLS do
  // Storage, já que a autorização já é feita pela própria API.
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey,
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'uploads',

  // E-mail de recuperação de senha (ver src/utils/email.js) — OPCIONAL, ao
  // contrário do Supabase acima: "esqueci minha senha" é uma feature
  // isolada, não faz sentido a API inteira recusar subir por causa dela.
  // Sem host/usuário/senha configurados, o envio só loga um aviso e segue
  // sem erro (ver email.js) — nunca derruba a request.
  smtpHost: process.env.SMTP_HOST || null,
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpUser: process.env.SMTP_USER || null,
  smtpPassword: process.env.SMTP_PASSWORD || null,
  // STARTTLS na porta 587 (mais comum) usa secure:false; porta 465 (SSL
  // direto) usa secure:true.
  smtpSecure: process.env.SMTP_SECURE === 'true',
  emailFrom: process.env.EMAIL_FROM || 'Portaria <no-reply@localhost>',

  passwordResetExpiresIn: process.env.PASSWORD_RESET_EXPIRES_IN || '30m',

  logLevel,

  // Rastreamento de erros (ver src/utils/sentry.js) — OPCIONAL, mesmo
  // critério do SMTP acima: sem DSN configurado, o Sentry simplesmente não
  // inicializa (não é uma dependência dura como o Supabase é pras fotos).
  sentryDsn: process.env.SENTRY_DSN || null,
};
