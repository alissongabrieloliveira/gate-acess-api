require('dotenv').config();

module.exports = {
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
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
