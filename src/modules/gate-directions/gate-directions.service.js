const AppError = require('../../utils/AppError');
const repository = require('./gate-directions.repository');
const withAuthTransaction = require('../../utils/withAuthTransaction');
const { sendCommandToGateway } = require('../../gatewayWs/gatewayWs');

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

async function setDirectionState(auth, directionRaw, action) {
  const direction = parseDirection(directionRaw);
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

  let ack;
  try {
    ack = await sendCommandToGateway(gatewayDeviceId, { outputIds, action });
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
