const AppError = require('./AppError');

// Folga para diferença de relógio entre o tablet da portaria e o servidor.
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Converte a data/hora recebida numa edição de registro (entrada/saída de
 * acesso, saída/retorno de frota) em Date, recusando valor inválido ou no
 * futuro — corrigir um registro não pode "agendar" uma passagem que ainda
 * não aconteceu.
 */
function parseEditTimestamp(value, label) {
  if (value === null || value === '') {
    throw new AppError(`${label} é obrigatória`, 400);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`${label} inválida`, 400);
  }
  if (date.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
    throw new AppError(`${label} não pode estar no futuro`, 400);
  }
  return date;
}

module.exports = parseEditTimestamp;
