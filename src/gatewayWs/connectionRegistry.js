/**
 * Conexões WS ativas dos gateways locais, indexadas por gateway_devices.id.
 *
 * Limitação explícita: Map em memória de um único processo. Se o backend um
 * dia rodar mais de uma instância, uma request atendida pela instância A não
 * alcança um gateway conectado na instância B. Aceitável para o MVP
 * (instância única no Railway); não resolvido aqui.
 */
const connections = new Map();
// Desde quando cada gateway está sem conexão (alerta do Dashboard). Quem
// nunca conectou desde o boot conta a partir do boot do processo — um deploy
// derruba todas as conexões e o gateway leva alguns segundos para voltar.
const disconnectedAt = new Map();
const startedAt = new Date();

function registerConnection(deviceId, ws) {
  connections.set(deviceId, ws);
  disconnectedAt.delete(deviceId);
}

function getConnection(deviceId) {
  return connections.get(deviceId) || null;
}

// Só remove se o ws ainda for a MESMA instância registrada — evita que uma
// reconexão rápida (nova conexão já registrada) seja apagada pelo evento
// "close" tardio da conexão antiga.
function removeConnection(deviceId, ws) {
  if (connections.get(deviceId) === ws) {
    connections.delete(deviceId);
    disconnectedAt.set(deviceId, new Date());
  }
}

/** null se conectado agora; senão, desde quando está sem conexão. */
function getOfflineSince(deviceId) {
  if (connections.has(deviceId)) return null;
  return disconnectedAt.get(deviceId) ?? startedAt;
}

module.exports = { registerConnection, getConnection, removeConnection, getOfflineSince };
