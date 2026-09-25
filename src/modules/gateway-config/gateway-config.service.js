const AppError = require('../../utils/AppError');
const repository = require('./gateway-config.repository');
const withAuthTransaction = require('../../utils/withAuthTransaction');
const { generateGatewayToken } = require('../../utils/gatewayToken');
const { sendOutputTestToGateway } = require('../../gatewayWs/gatewayWs');
const logger = require('../../utils/logger');

const UNIQUE_VIOLATION = '23505';
const VALID_DIRECTIONS = ['ENTRY', 'EXIT'];
const TEST_MODES = ['pulse', 'on', 'off'];
const MAX_TEST_PULSE_SECONDS = 10;

function toDeviceDTO(device) {
  if (!device) return null;
  return { id: device.id, name: device.name, lastSeenAt: device.last_seen_at, createdAt: device.created_at };
}

function toOutputDTO(output) {
  return {
    id: output.id,
    direction: output.direction,
    outputNumber: output.output_number,
    host: output.host,
    port: output.port,
    ns: output.ns,
    currentState: output.current_state,
  };
}

function validateOutputPayload({ direction, outputNumber, host, port, ns }) {
  if (!VALID_DIRECTIONS.includes(direction)) {
    throw new AppError('Direção inválida — use "ENTRY" ou "EXIT"', 400);
  }
  if (!Number.isInteger(outputNumber) || outputNumber < 1 || outputNumber > 4) {
    throw new AppError('Número da saída precisa ser um inteiro entre 1 e 4', 400);
  }
  if (typeof host !== 'string' || host.trim().length === 0) {
    throw new AppError('Host é obrigatório', 400);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AppError('Porta precisa ser um inteiro entre 1 e 65535', 400);
  }
  if (typeof ns !== 'string' || ns.length !== 5) {
    throw new AppError('Ns (serial) precisa ter exatamente 5 caracteres', 400);
  }
}

async function getConfig(companyId) {
  const [device, outputs] = await Promise.all([
    repository.findActiveDeviceByCompany(companyId),
    repository.listOutputsByCompany(companyId),
  ]);
  return { device: toDeviceDTO(device), outputs: outputs.map(toOutputDTO) };
}

async function createDevice(auth, name) {
  const existing = await repository.findActiveDeviceByCompany(auth.companyId);
  if (existing) {
    throw new AppError('Já existe um gateway ativo — revogue antes de provisionar outro', 409);
  }

  const { raw, hash } = generateGatewayToken();

  const device = await withAuthTransaction(auth, async (trx) => {
    const inserted = await repository.insertDevice({ company_id: auth.companyId, name: name || 'Gateway Principal', token_hash: hash }, trx);
    // Reatribui saídas de um device anterior (revogado) pro novo — mantém
    // a fiação configurada em vez de forçar recriar saída por saída.
    await repository.reassignOutputsToDevice(auth.companyId, inserted.id, trx);
    return inserted;
  });

  return { ...toDeviceDTO(device), token: raw };
}

async function revokeDevice(auth) {
  const device = await repository.findActiveDeviceByCompany(auth.companyId);
  if (!device) {
    throw new AppError('Nenhum gateway ativo para revogar', 400);
  }
  await repository.revokeDevice(device.id, auth.companyId);
}

async function createOutput(auth, payload) {
  const device = await repository.findActiveDeviceByCompany(auth.companyId);
  if (!device) {
    throw new AppError('Provisione um gateway antes de configurar saídas', 400);
  }
  validateOutputPayload(payload);

  try {
    const output = await withAuthTransaction(auth, (trx) =>
      repository.insertOutput(
        {
          company_id: auth.companyId,
          gateway_device_id: device.id,
          direction: payload.direction,
          output_number: payload.outputNumber,
          host: payload.host,
          port: payload.port,
          ns: payload.ns,
        },
        trx
      )
    );
    return toOutputDTO(output);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw new AppError('Já existe uma saída com esse número configurada neste gateway', 409);
    }
    throw err;
  }
}

async function updateOutput(auth, id, payload) {
  const existing = await repository.findOutputByIdAndCompany(id, auth.companyId);
  if (!existing) {
    throw new AppError('Saída não encontrada', 404);
  }

  const merged = {
    direction: payload.direction ?? existing.direction,
    outputNumber: payload.outputNumber ?? existing.output_number,
    host: payload.host ?? existing.host,
    port: payload.port ?? existing.port,
    ns: payload.ns ?? existing.ns,
  };
  validateOutputPayload(merged);

  try {
    const output = await withAuthTransaction(auth, (trx) =>
      repository.updateOutput(
        id,
        auth.companyId,
        {
          direction: merged.direction,
          output_number: merged.outputNumber,
          host: merged.host,
          port: merged.port,
          ns: merged.ns,
        },
        trx
      )
    );
    return toOutputDTO(output);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw new AppError('Já existe uma saída com esse número configurada neste gateway', 409);
    }
    throw err;
  }
}

async function deleteOutput(auth, id) {
  const existing = await repository.findOutputByIdAndCompany(id, auth.companyId);
  if (!existing) {
    throw new AppError('Saída não encontrada', 404);
  }
  await withAuthTransaction(auth, (trx) => repository.deleteOutput(id, auth.companyId, trx));
}

/**
 * Aciona UMA saída avulsa (tela de diagnóstico): pulso de N segundos ou
 * liga/desliga sustentado. Feito pra testar em campo cada braço da cancela
 * dupla separadamente. NÃO atualiza current_state — o estado presumido das
 * cancelas continua sendo o da última ação por direção.
 */
async function testOutput(auth, id, { mode, seconds } = {}) {
  if (!TEST_MODES.includes(mode)) {
    throw new AppError('Modo de teste inválido — use "pulse", "on" ou "off"', 400);
  }
  if (mode === 'pulse' && (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_TEST_PULSE_SECONDS)) {
    throw new AppError(`Tempo do pulso precisa ser um inteiro entre 1 e ${MAX_TEST_PULSE_SECONDS} segundos`, 400);
  }

  const output = await repository.findOutputByIdAndCompany(id, auth.companyId);
  if (!output) {
    throw new AppError('Saída não encontrada', 404);
  }

  const pulseSeconds = mode === 'pulse' ? seconds : undefined;
  // Pulso: o módulo pode só responder no fim — timeout acompanha o tempo.
  const timeoutMs = mode === 'pulse' ? seconds * 1000 + 5000 : 5000;

  let ack;
  try {
    ack = await sendOutputTestToGateway(
      output.gateway_device_id,
      { outputId: output.id, mode, seconds: pulseSeconds },
      timeoutMs
    );
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Tempo esgotado aguardando o gateway — confira se ele está atualizado e conectado', 504);
  }

  if (!ack.ok) {
    throw new AppError(`Gateway reportou falha ao acionar a saída: ${ack.error}`, 502);
  }

  logger.info(
    { companyId: auth.companyId, userId: auth.userId, outputId: output.id, outputNumber: output.output_number, mode, seconds: pulseSeconds },
    'Teste de saída avulsa acionado'
  );

  return { outputId: output.id, outputNumber: output.output_number, mode, seconds: pulseSeconds ?? null };
}

module.exports = { getConfig, createDevice, revokeDevice, createOutput, updateOutput, deleteOutput, testOutput };
