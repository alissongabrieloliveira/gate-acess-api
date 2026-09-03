const UNIT_MS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/** Converte strings como "15m", "7d", "1h" em milissegundos. */
function parseDuration(value) {
  const match = /^(\d+)(s|m|h|d)$/.exec(String(value).trim());
  if (!match) {
    throw new Error(`Formato de duração inválido: ${value}`);
  }
  const [, amount, unit] = match;
  return Number(amount) * UNIT_MS[unit];
}

module.exports = parseDuration;
