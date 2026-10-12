const repository = require('./dashboard.repository');
const AppError = require('../../utils/AppError');
const RULES = require('../../config/rules');
const { decryptField } = require('../../utils/crypto');
const connectionRegistry = require('../../gatewayWs/connectionRegistry');
const peopleService = require('../people/people.service');
const vehiclesService = require('../vehicles/vehicles.service');

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

const HOUR_MS = 60 * 60 * 1000;
// Limites combinados com o cliente (2026-10-12).
const PERSON_INSIDE_HOURS = 12;
const FLEET_ON_TRIP_HOURS = 24;
const RETROACTIVE_WINDOW_HOURS = 24;
// Tolerância para a reconexão do gateway (deploy do backend, queda rápida de
// internet) não virar alerta.
const GATEWAY_OFFLINE_GRACE_MS = 2 * 60 * 1000;

function personSummary(people, id) {
  const person = people.get(id);
  return person ? { id: person.id, name: person.name, personType: person.personType } : null;
}

function vehicleSummary(vehicles, id) {
  const vehicle = vehicles.get(id);
  return vehicle
    ? { id: vehicle.id, licensePlate: vehicle.licensePlate, identificationCode: vehicle.identificationCode }
    : null;
}

async function gatewayOfflineAlert(companyId, now) {
  const device = await repository.findActiveGatewayDevice(companyId);
  if (!device) return null;
  const offlineSince = connectionRegistry.getOfflineSince(device.id);
  if (!offlineSince || now - offlineSince < GATEWAY_OFFLINE_GRACE_MS) return null;
  return { name: device.name, offlineSince, lastSeenAt: device.last_seen_at };
}

const ACCESS_RETROACTIVE = {
  kind: 'ACCESS',
  events: [
    {
      event: 'ENTRY',
      reasonColumn: 'entry_retroactive_reason_encrypted',
      recordedColumn: 'created_at',
      timeColumn: 'entry_time',
      operatorColumn: 'entry_operator_id',
    },
    {
      event: 'EXIT',
      reasonColumn: 'exit_retroactive_reason_encrypted',
      recordedColumn: 'exit_recorded_at',
      timeColumn: 'exit_time',
      operatorColumn: 'exit_operator_id',
    },
  ],
};

const FLEET_RETROACTIVE = {
  kind: 'FLEET',
  events: [
    {
      event: 'DEPARTURE',
      reasonColumn: 'departure_retroactive_reason_encrypted',
      recordedColumn: 'created_at',
      timeColumn: 'departure_time',
      operatorColumn: 'departure_operator_id',
    },
    {
      event: 'RETURN',
      reasonColumn: 'return_retroactive_reason_encrypted',
      recordedColumn: 'return_recorded_at',
      timeColumn: 'return_time',
      operatorColumn: 'return_operator_id',
    },
  ],
};

// Uma linha por registro, com as passagens lançadas como retroativas dentro
// da janela (entrada e saída lançadas juntas viram uma linha só).
function retroactiveItems(rows, since, spec) {
  return rows.map((row) => {
    const events = spec.events
      .filter((e) => row[e.reasonColumn] && row[e.recordedColumn] >= since)
      .map((e) => ({
        event: e.event,
        informedTime: row[e.timeColumn],
        recordedAt: row[e.recordedColumn],
        operatorId: row[e.operatorColumn],
        reason: decryptField(row[e.reasonColumn]),
      }));
    const latest = events.reduce((a, b) => (b.recordedAt > a.recordedAt ? b : a));
    return { kind: spec.kind, row, events, recordedAt: latest.recordedAt, operatorId: latest.operatorId };
  });
}

async function recentRetroactive(companyId, since) {
  const [accessRows, fleetRows] = await Promise.all([
    repository.listRecentRetroactiveAccesses(companyId, since),
    repository.listRecentRetroactiveFleetLogs(companyId, since),
  ]);
  return [
    ...retroactiveItems(accessRows, since, ACCESS_RETROACTIVE),
    ...retroactiveItems(fleetRows, since, FLEET_RETROACTIVE),
  ].sort((a, b) => b.recordedAt - a.recordedAt);
}

/**
 * Alertas do sininho (TopBar), calculados na hora a partir da
 * situação atual — sem tabela de notificações: o alerta some sozinho quando o
 * problema é resolvido (saída registrada, gateway de volta).
 * Lançamentos retroativos recentes: só para admin (`null` para o operador).
 */
async function alerts(auth) {
  const { companyId } = auth;
  const isAdmin = Boolean(auth.rules & RULES.ADMIN);
  const now = new Date();

  const [accessRows, fleetRows, gatewayOffline, retroactive] = await Promise.all([
    repository.listActiveAccessesEnteredBefore(companyId, new Date(now - PERSON_INSIDE_HOURS * HOUR_MS)),
    repository.listOnTripDepartedBefore(companyId, new Date(now - FLEET_ON_TRIP_HOURS * HOUR_MS)),
    gatewayOfflineAlert(companyId, now),
    isAdmin ? recentRetroactive(companyId, new Date(now - RETROACTIVE_WINDOW_HOURS * HOUR_MS)) : null,
  ]);

  const retroItems = retroactive ?? [];
  const retroRows = retroItems.map((item) => item.row);
  const [people, vehicles, users] = await Promise.all([
    peopleService.summariesByIds(companyId, [
      ...accessRows.map((r) => r.person_id),
      ...fleetRows.map((r) => r.driver_id),
      ...retroRows.map((r) => r.person_id ?? r.driver_id),
    ]),
    vehiclesService.summariesByIds(
      companyId,
      [...accessRows, ...fleetRows, ...retroRows].map((r) => r.vehicle_id)
    ),
    repository.findUsersByIds(companyId, [...new Set(retroItems.map((item) => item.operatorId).filter(Boolean))]),
  ]);
  const userNames = new Map(users.map((u) => [u.id, decryptField(u.name_encrypted)]));

  return {
    thresholds: { personInsideHours: PERSON_INSIDE_HOURS, fleetOnTripHours: FLEET_ON_TRIP_HOURS },
    peopleInsideTooLong: accessRows.map((r) => ({
      logId: r.id,
      entryTime: r.entry_time,
      person: personSummary(people, r.person_id),
      vehicle: vehicleSummary(vehicles, r.vehicle_id),
    })),
    fleetOnTripTooLong: fleetRows.map((r) => ({
      logId: r.id,
      departureTime: r.departure_time,
      destination: r.destination,
      isCarried: Boolean(r.transport_log_id),
      vehicle: vehicleSummary(vehicles, r.vehicle_id),
      driver: personSummary(people, r.driver_id),
    })),
    gatewayOffline,
    recentRetroactive:
      retroactive &&
      retroactive.map(({ kind, row, events, recordedAt, operatorId }) => ({
        kind,
        logId: row.id,
        events: events.map(({ event, informedTime, reason }) => ({ event, informedTime, reason })),
        recordedAt,
        operatorName: userNames.get(operatorId) ?? null,
        person: kind === 'ACCESS' ? personSummary(people, row.person_id) : null,
        driver: kind === 'FLEET' ? personSummary(people, row.driver_id) : null,
        vehicle: vehicleSummary(vehicles, row.vehicle_id),
      })),
  };
}

module.exports = { summary, alerts };
