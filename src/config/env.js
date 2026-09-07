require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

const fieldEncryptionKey = Buffer.from(required('FIELD_ENCRYPTION_KEY'), 'base64');
if (fieldEncryptionKey.length !== 32) {
  throw new Error('FIELD_ENCRYPTION_KEY deve decodificar (base64) para exatamente 32 bytes');
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3333,
  databaseUrl: required('DATABASE_URL'),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  refreshTokenExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

  fieldEncryptionKey,
  // Deve ser o mesmo valor configurado em `app.bindex_pepper` no Postgres
  // (ALTER DATABASE ... SET app.bindex_pepper = '...'), já que o blind index é
  // gerado aqui no Node (ver src/utils/bindex.js) para evitar um round-trip
  // extra ao banco só para calcular o hash de busca.
  bindexPepper: required('BINDEX_PEPPER'),

  // Fotos de people/vehicles vivem no Supabase Storage (ver
  // src/utils/supabaseStorage.js) — sem fallback em disco local, por isso
  // são obrigatórias: sem elas a app não tem como servir/receber foto
  // nenhuma. Service Role Key (não a anon/public) — precisa bypassar RLS do
  // Storage, já que a autorização já é feita pela própria API.
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
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
};
