/**
 * Conexões WS ativas dos gateways locais, indexadas por gateway_devices.id.
 *
 * Limitação explícita: Map em memória de um único processo. Se o backend um
 * dia rodar mais de uma instância, uma request atendida pela instância A não
 * alcança um gateway conectado na instância B. Aceitável para o MVP
 * (instância única no Railway); não resolvido aqui.
 */
const connections = new Map();

function registerConnection(deviceId, ws) {
  connections.set(deviceId, ws);
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
  }
}

module.exports = { registerConnection, getConnection, removeConnection };
