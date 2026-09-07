// Jest `setupFiles`: roda em CADA arquivo de teste, antes de qualquer módulo
// da aplicação ser importado nesse arquivo — precisa carregar as variáveis
// de teste ANTES de config/env.js/knexfile.js/config/db.js serem exigidos
// pela primeira vez (env.js lança erro na importação se
// DATABASE_URL/JWT_ACCESS_SECRET/FIELD_ENCRYPTION_KEY/BINDEX_PEPPER não
// estiverem no process.env nesse momento).
//
// Não conflita com o dotenv.config() que env.js/knexfile.js já chamam
// sozinhos (sem path, carregando .env): por padrão o dotenv NUNCA sobrescreve
// uma variável já setada em process.env, então essas chamadas tardias viram
// no-op pras variáveis que já setamos aqui.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });
