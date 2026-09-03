const AppError = require('./AppError');

/**
 * As FKs de access_logs/fleet_logs (person_id, vehicle_id, entry_gate_id, etc.) só
 * garantem que o ID existe em algum lugar — não que pertence à MESMA empresa do
 * usuário autenticado. Sem essa checagem na aplicação, um operador poderia
 * referenciar um registro de outro tenant. Reaproveita o `findByIdAndCompany`
 * (mesma assinatura em people/vehicles/gates/sectors) para validar posse.
 */
async function assertBelongsToCompany(repository, id, companyId, notFoundMessage) {
  const record = await repository.findByIdAndCompany(id, companyId);
  if (!record) {
    throw new AppError(notFoundMessage, 400);
  }
  return record;
}

module.exports = assertBelongsToCompany;
