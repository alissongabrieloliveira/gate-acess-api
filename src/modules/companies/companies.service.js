const AppError = require('../../utils/AppError');
const repository = require('./companies.repository');

/**
 * Só leitura por enquanto: o schema (gate_schema.sql) só define policy de SELECT
 * para companies — não há INSERT/UPDATE. Criação de tenant acontece hoje só via
 * seed (backend/src/db/seeds); atualização do perfil da empresa exigiria uma nova
 * migration adicionando policy de UPDATE antes de ter sentido expor essa rota.
 */
async function getOwnCompany(companyId) {
  const company = await repository.findById(companyId);
  if (!company) {
    throw new AppError('Empresa não encontrada', 404);
  }
  return company;
}

module.exports = { getOwnCompany };
