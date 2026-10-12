require('dotenv').config();

module.exports = {
  client: 'pg',
  // CLI do knex (migrations e seeds) conecta como DONO das tabelas. Com
  // MIGRATION_DATABASE_URL definida, ela é a do dono e DATABASE_URL fica só
  // para a aplicação, que conecta com o papel app_runtime, sujeito ao RLS
  // (config/db.js, claude.md seção 5.5). Sem ela, tudo usa DATABASE_URL.
  connection: {
    connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
    // Postgres gerenciado (Supabase, Railway etc.) exige SSL em conexão
    // externa, com um certificado que o Node não reconhece por padrão
    // (cadeia autoassinada) — sem isso a conexão falha com
    // SELF_SIGNED_CERT_IN_CHAIN. Só em produção: o Postgres local de
    // desenvolvimento (docker-compose) não usa SSL nenhum.
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  },
  migrations: {
    directory: './src/db/migrations',
  },
  seeds: {
    directory: './src/db/seeds',
  },
};
