const repository = require('./cities.repository');

function toDTO(city) {
  if (!city) return null;
  return {
    id: city.id,
    name: city.name,
    stateAbbr: city.state_abbr,
    ibgeCode: city.ibge_code,
  };
}

/**
 * Diferente dos outros cadastros (people/vehicles/gates...), `cities` é
 * global (sem company_id) e grande demais (~5.570 municípios) pro padrão de
 * "carregar até 100 de uma vez" usado em outros lugares — por isso é busca
 * de verdade no servidor (`?search=`), não uma amostra que o cliente filtra.
 */
async function list({ page, limit, search } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const filters = { search: search?.trim() || undefined };

  const [rows, totalRow] = await Promise.all([
    repository.listAll({ limit: safeLimit, offset, ...filters }),
    repository.count(filters),
  ]);

  return {
    data: rows.map(toDTO),
    pagination: { page: safePage, limit: safeLimit, total: Number(totalRow.count) },
  };
}

module.exports = { list };
