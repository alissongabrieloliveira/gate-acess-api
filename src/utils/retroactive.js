const AppError = require('./AppError');
const parseEditTimestamp = require('./parseEditTimestamp');
const RULES = require('../config/rules');

// Operador lança até 7 dias para trás (esquecimento do dia/fim de semana);
// admin sem limite.
const OPERATOR_MAX_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const REASON_MIN = 5;
const REASON_MAX = 255;

/**
 * Data/hora de um lançamento retroativo (entrada/saída de acesso, saída/
 * retorno de frota que o operador esqueceu de registrar na hora). `undefined`/
 * null/'' = lançamento normal, na hora do servidor -> `null`. Recusa data
 * inválida, no futuro, ou (para quem não é admin) mais antiga que 7 dias.
 */
function parseRetroactiveTime(auth, value, label) {
  if (value === undefined || value === null || value === '') return null;
  const date = parseEditTimestamp(value, label);
  const isAdmin = Boolean(auth.rules & RULES.ADMIN);
  if (!isAdmin && Date.now() - date.getTime() > OPERATOR_MAX_DAYS * DAY_MS) {
    throw new AppError(
      `${label}: o lançamento retroativo vai até ${OPERATOR_MAX_DAYS} dias atrás — ` +
        'para uma data mais antiga, peça a um administrador',
      400
    );
  }
  return date;
}

/** Justificativa obrigatória de todo lançamento retroativo (texto em claro). */
function parseRetroactiveReason(value) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (text.length < REASON_MIN) {
    throw new AppError('Informe o motivo do lançamento retroativo', 400);
  }
  if (text.length > REASON_MAX) {
    throw new AppError(`Motivo do lançamento retroativo pode ter no máximo ${REASON_MAX} caracteres`, 400);
  }
  return text;
}

function formatDateTime(value) {
  return new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

module.exports = { parseRetroactiveTime, parseRetroactiveReason, formatDateTime, OPERATOR_MAX_DAYS };
