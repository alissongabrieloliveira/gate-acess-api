const AppError = require('../../utils/AppError');
const repository = require('./gate-directions.repository');
const withAuthTransaction = require('../../utils/withAuthTransaction');
const { sendCommandToGateway } = require('../../gatewayWs/gatewayWs');
const RULES = require('../../config/rules');

// O gateway manda um pulso de 5s e só confirma depois que o módulo responde
// (o que pode ser só no fim do pulso) — o timeout padrão de 5s não basta.
const GATEWAY_TIMEOUT_MS = 10000;

const DIRECTIONS = { ENTRY: 'ENTRY', EXIT: 'EXIT' };
const LABELS = { ENTRY: 'Entrada', EXIT: 'Saída' };

function parseDirection(raw) {
  const direction = String(raw || '').toUpperCase();
  if (!DIRECTIONS[direction]) {
    throw new AppError('Direção inválida — use "entry" ou "exit"', 400);
  }
  return direction;
}

// Agrega o estado das N saídas de uma direção: 'ON' só se todas ligadas,
// 'OFF' só se todas desligadas, 'MIXED' se divergirem (não deveria
// acontecer em operação normal — as saídas de uma mesma direção são sempre
// acionadas juntas — mas o dado não deve mentir se acontecer).
function aggregateState(outputs) {
  const states = new Set(outputs.map((o) => o.current_state));
  if (states.size === 1) return [...states][0];
  return 'MIXED';
}

function groupToDTO(direction, outputs) {
  return {
    direction,
    label: LABELS[direction],
    currentState: aggregateState(outputs),
    outputs: outputs.map((o) => ({ outputNumber: o.output_number, currentState: o.current_state })),
    gatewayDeviceId: outputs[0]?.gateway_device_id ?? null,
  };
}

async function list(companyId) {
  const rows = await repository.listByCompany(companyId);
  const byDirection = { ENTRY: [], EXIT: [] };
  for (const row of rows) {
    byDirection[row.direction]?.push(row);
  }

  const data = Object.keys(DIRECTIONS)
    .filter((direction) => byDirection[direction].length > 0)
    .map((direction) => groupToDTO(direction, byDirection[direction]));

  return { data };
}

// Um comando por vez por cancela (por empresa). Com placa de impulso, 2
// cliques "abrir" simultâneos (ex.: 2 tablets) virariam 2 pulsos — o 2º
// FECHARIA a cancela. Serializando, o 2º já enxerga o estado atualizado pelo
// 1º e vira no-op. Em memória: basta enquanto o backend roda em 1 instância.
const directionLocks = new Map();

function withDirectionLock(key, fn) {
  const previous = directionLocks.get(key) || Promise.resolve();
  const current = previous.then(fn, fn);
  const tail = current.catch(() => {});
  directionLocks.set(key, tail);
  tail.then(() => {
    if (directionLocks.get(key) === tail) directionLocks.delete(key);
  });
  return current;
}

/**
 * As cancelas são de impulso: cada pulso ALTERNA abre/fecha, e o app não lê
 * o estado real (currentState é o estado presumido pela última ação). Por
 * isso só se manda pulso quando o estado presumido é diferente do pedido —
 * "abrir" numa cancela já aberta não faz nada (senão fecharia). `force` (só
 * admin, tela de diagnóstico) pulsa mesmo assim: serve pra ressincronizar
 * quando o estado presumido divergir do real (ex.: alguém usou a botoeira).
 */
async function setDirectionState(auth, directionRaw, action, { force = false } = {}) {
  const direction = parseDirection(directionRaw);
  const canForce = force && Boolean(auth.rules & RULES.ADMIN);
  return withDirectionLock(`${auth.companyId}:${direction}`, () =>
    pulseDirection(auth, direction, action, canForce)
  );
}

async function pulseDirection(auth, direction, action, force) {
  const outputs = await repository.findByDirectionAndCompany(direction, auth.companyId);
  if (outputs.length === 0) {
    throw new AppError(`Nenhuma saída configurada para a cancela de ${LABELS[direction].toLowerCase()}`, 400);
  }

  const gatewayDeviceIds = new Set(outputs.map((o) => o.gateway_device_id));
  if (gatewayDeviceIds.size > 1) {
    throw new AppError('Configuração inconsistente: as saídas desta cancela apontam para gateways diferentes', 500);
  }
  const gatewayDeviceId = outputs[0].gateway_device_id;
  const outputIds = outputs.map((o) => o.id);
  const targetState = action === 'open' ? 'ON' : 'OFF';

  if (!force && aggregateState(outputs) === targetState) {
    return groupToDTO(direction, outputs);
  }

  let ack;
  try {
    ack = await sendCommandToGateway(gatewayDeviceId, { outputIds, action }, GATEWAY_TIMEOUT_MS);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Tempo esgotado aguardando resposta do gateway', 504);
  }

  if (!ack.ok) {
    throw new AppError(`Gateway reportou falha ao acionar a cancela: ${ack.error}`, 502);
  }

  const updated = await withAuthTransaction(auth, (trx) =>
    repository.updateStateByIds(outputIds, auth.companyId, targetState, trx)
  );

  return groupToDTO(direction, updated);
}

module.exports = { list, setDirectionState };
