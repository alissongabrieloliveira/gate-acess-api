/**
 * Bitmask de permissões (users.rules). Ainda não existe um esquema granular por
 * módulo — só a permissão de admin geral existe por enquanto. Estender aqui
 * conforme os módulos forem definindo suas próprias permissões.
 */
const RULES = {
  ADMIN: 1 << 0,
};

module.exports = RULES;
