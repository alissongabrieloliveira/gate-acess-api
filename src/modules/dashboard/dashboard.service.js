const repository = require('./dashboard.repository');
const AppError = require('../../utils/AppError');

const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
// A tela pede 7 dias; o teto só evita uma agregação sobre o histórico inteiro.
const MAX_RANGE_DAYS = 31;

function parseTimeZone(timeZone) {
  if (!timeZone) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    throw new AppError('Fuso horário inválido', 400);
  }
}

function parseFrom(from) {
  const date = from ? new Date(from) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new AppError('Parâmetro "from" obrigatório (data ISO)', 400);
  }
  const oldest = Date.now() - MAX_RANGE_DAYS * 24 * 60 * 60 * 1000;
  if (date.getTime() < oldest || date.getTime() > Date.now()) {
    throw new AppError(`"from" precisa estar entre hoje e ${MAX_RANGE_DAYS} dias atrás`, 400);
  }
  return date;
}

/**
 * Números do Dashboard contados direto no banco (antes o frontend contava
 * sobre uma amostra de até 100 cadastros/acessos e sub-contava).
 * `accessesByDay` vem por dia (no fuso do operador) e por posto de entrada:
 * a tela monta o gráfico semanal (com filtro de posto) e o "Acessos por
 * Posto" a partir da mesma lista.
 */
async function summary(companyId, { from, timeZone } = {}) {
  const fromDate = parseFrom(from);
  const tz = parseTimeZone(timeZone);

  const [blockedPeople, blockedVehicles, newPeople, accessRows] = await Promise.all([
    repository.countBlocked('people', companyId),
    repository.countBlocked('vehicles', companyId),
    repository.countPeopleCreatedSince(companyId, fromDate),
    repository.countAccessesByDayAndGate(companyId, fromDate, tz),
  ]);

  return {
    blockedPeople: Number(blockedPeople.count),
    blockedVehicles: Number(blockedVehicles.count),
    newPeople: Number(newPeople.count),
    accessesByDay: accessRows.map((row) => ({
      date: row.day,
      gateId: row.entry_gate_id,
      count: Number(row.count),
    })),
  };
}

module.exports = { summary };
