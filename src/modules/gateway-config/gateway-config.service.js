const AppError = require('../../utils/AppError');
const repository = require('./gateway-config.repository');
const withAuthTransaction = require('../../utils/withAuthTransaction');
const { generateGatewayToken } = require('../../utils/gatewayToken');

const UNIQUE_VIOLATION = '23505';
const VALID_DIRECTIONS = ['ENTRY', 'EXIT'];

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

module.exports = { getConfig, createDevice, revokeDevice, createOutput, updateOutput, deleteOutput };
