const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const db = require('../config/db');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { authenticateGatewayToken } = require('./deviceAuth');
const { registerConnection, getConnection, removeConnection } = require('./connectionRegistry');
const { createPendingCommand, resolvePendingCommand } = require('./pendingCommands');

const WS_PATH = '/ws/gateway';

function extractBearerToken(authorizationHeader) {
  const [scheme, token] = (authorizationHeader || '').split(' ');
  return scheme === 'Bearer' ? token : null;
}

/**
 * Anexa o WebSocket server do gateway ao http.Server já existente (mesma
 * porta da API REST). Autenticação via header HTTP no handshake (não uma
 * mensagem JSON inicial) — rejeita upgrades não autenticados antes de
 * existir sessão WS, sem precisar de um estado "aguardando auth" no
 * handler de mensagens.
 */
function attachGatewayWs(httpServer) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: WS_PATH,
    verifyClient: (info, callback) => {
      const token = extractBearerToken(info.req.headers.authorization);
      authenticateGatewayToken(token)
        .then((device) => {
          if (!device) {
            callback(false, 401, 'unauthorized');
            return;
          }
          info.req.gatewayDevice = device;
          callback(true);
        })
        .catch((err) => {
          logger.error({ err }, 'Erro autenticando conexão de gateway');
          callback(false, 500, 'internal error');
        });
    },
  });

  wss.on('connection', (ws, req) => {
    const device = req.gatewayDevice;
    registerConnection(device.id, ws);
    logger.info({ gatewayDeviceId: device.id }, 'Gateway conectado');

    db('gateway_devices')
      .where({ id: device.id })
      .update({ last_seen_at: db.fn.now() })
      .catch((err) => logger.warn({ err, gatewayDeviceId: device.id }, 'Falha ao atualizar last_seen_at do gateway'));

    // Envia a config de saídas (host/porta/número/serial) assim que o
    // gateway autentica — é assim que ele descobre com qual controlador
    // físico falar, sem precisar de um arquivo local na máquina do
    // cliente. Só enviada nesta conexão inicial; uma mudança de config
    // (reseed) só é pega na próxima reconexão do gateway.
    db('gate_direction_outputs')
      .select({ outputId: 'id', host: 'host', port: 'port', outputNumber: 'output_number', ns: 'ns' })
      .where({ gateway_device_id: device.id })
      .then((outputs) => ws.send(JSON.stringify({ type: 'config', outputs })))
      .catch((err) => logger.error({ err, gatewayDeviceId: device.id }, 'Falha ao carregar/enviar config de saídas do gateway'));

    ws.on('message', (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        logger.warn({ gatewayDeviceId: device.id }, 'Mensagem não-JSON recebida do gateway, ignorada');
        return;
      }

      if (payload?.type !== 'ack' || !payload.requestId) {
        logger.warn({ gatewayDeviceId: device.id, payload }, 'Mensagem de gateway não reconhecida, ignorada');
        return;
      }

      resolvePendingCommand(payload.requestId, payload);
    });

    ws.on('error', (err) => {
      logger.warn({ err, gatewayDeviceId: device.id }, 'Erro na conexão do gateway');
    });

    ws.on('close', () => {
      removeConnection(device.id, ws);
      logger.info({ gatewayDeviceId: device.id }, 'Gateway desconectado');
    });
  });

  return wss;
}

/**
 * Envia um comando de abrir/fechar a um gateway conectado e aguarda o ack.
 * `outputIds` referencia 1 ou mais linhas de gate_direction_outputs — o
 * gateway resolve cada id pra sua saída física local e monta um único
 * frame MTCP acionando todas ao mesmo tempo (ver gateway/src/commandHandler.js).
 */
function sendCommandToGateway(gatewayDeviceId, { outputIds, action }, timeoutMs = 5000) {
  const ws = getConnection(gatewayDeviceId);
  if (!ws) {
    throw new AppError('Gateway do cliente está offline', 503);
  }

  const requestId = crypto.randomUUID();
  const promise = createPendingCommand(requestId, timeoutMs);
  ws.send(JSON.stringify({ type: 'command', requestId, outputIds, action }));
  return promise;
}

module.exports = { attachGatewayWs, sendCommandToGateway };
