/**
 * Registro de comandos enviados a um gateway aguardando ack, por requestId.
 * O protocolo WS não garante resposta (gateway pode cair no meio) — por
 * isso todo comando tem timeout próprio, responsabilidade do backend, não
 * do gateway (ver gatewayWs.js#sendCommandToGateway).
 */
const pending = new Map();

function createPendingCommand(requestId, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('Tempo esgotado aguardando resposta do gateway'));
    }, timeoutMs);

    pending.set(requestId, { resolve, reject, timer });
  });
}

function resolvePendingCommand(requestId, ackPayload) {
  const entry = pending.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.resolve(ackPayload);
}

function rejectPendingCommand(requestId, err) {
  const entry = pending.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.reject(err);
}

module.exports = { createPendingCommand, resolvePendingCommand, rejectPendingCommand };
