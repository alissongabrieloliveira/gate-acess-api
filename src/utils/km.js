const AppError = require('./AppError');

// Teto de sanidade: um odômetro real não passa disso, e valores maiores
// estouram o INT do Postgres (erro 500 em vez de 400).
const MAX_KM = 9999999;

/**
 * Resolve o KM recebido no payload para o valor a gravar.
 *  - `unavailable` (operador marcou "KM indisponível"): ignora qualquer número
 *    e devolve null, pra nunca coexistir um número com o flag de indisponível.
 *  - vazio: obrigatório -> 400; opcional -> null.
 *  - preenchido: precisa ser inteiro entre 0 e MAX_KM (senão 400).
 */
function resolveKm(value, { unavailable = false, required = false, label }) {
  if (unavailable) return null;
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new AppError(`${label} é obrigatório (ou marque "KM indisponível")`, 400);
    }
    return null;
  }
  const km = Number(value);
  if (!Number.isInteger(km) || km < 0 || km > MAX_KM) {
    throw new AppError(`${label} inválido: informe um número inteiro entre 0 e ${MAX_KM}`, 400);
  }
  return km;
}

module.exports = { MAX_KM, resolveKm };
