// WebSocket do gateway (src/gatewayWs) de ponta a ponta: handshake com token,
// config de saídas enviada na conexão e o aviso de encerramento normal
// (`shutdown`) que o app do gateway manda quando o porteiro o fecha — grava
// gateway_devices.closed_by_operator_at, e a reconexão limpa. A API roda como
// app_runtime, então tudo passa pelo RLS.
const http = require('http');
const WebSocket = require('ws');
const app = require('../../src/app');
const db = require('../helpers/db');
const { attachGatewayWs } = require('../../src/gatewayWs/gatewayWs');
const { hashGatewayToken } = require('../../src/utils/gatewayToken');
const { createCompany } = require('../helpers/factories');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('Tempo esgotado esperando a condição');
    await wait(50);
  }
}

describe('WebSocket do gateway', () => {
  let server;
  let wss;
  let url;
  let device;
  const rawToken = `token-ws-teste-${Date.now()}`;

  // Conecta e devolve o socket junto com a primeira mensagem (a config).
  function connectGateway(token = rawToken) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
      ws.once('message', (raw) => resolve({ ws, config: JSON.parse(raw.toString('utf8')) }));
      ws.once('unexpected-response', (req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.once('error', reject);
    });
  }

  function closeGateway(ws) {
    return new Promise((resolve) => {
      ws.once('close', resolve);
      ws.close();
    });
  }

  beforeAll(async () => {
    const company = await createCompany();
    [device] = await db('gateway_devices')
      .insert({ company_id: company.id, name: 'Gateway WS Teste', token_hash: hashGatewayToken(rawToken) })
      .returning('*');
    await db('gate_direction_outputs').insert({
      company_id: company.id,
      gateway_device_id: device.id,
      direction: 'ENTRY',
      output_number: 1,
      host: '127.0.0.1',
      port: 5000,
      ns: '00000',
    });

    server = http.createServer(app);
    wss = attachGatewayWs(server);
    await new Promise((resolve) => server.listen(0, resolve));
    url = `ws://127.0.0.1:${server.address().port}/ws/gateway`;
  });

  afterAll(async () => {
    wss.close();
    await new Promise((resolve) => server.close(resolve));
    await db.destroy();
  });

  test('token inválido é recusado no handshake', async () => {
    await expect(connectGateway('token-errado')).rejects.toThrow('HTTP 401');
  });

  test('ao conectar recebe a config das saídas da própria empresa', async () => {
    const { ws, config } = await connectGateway();
    expect(config).toEqual({
      type: 'config',
      outputs: [expect.objectContaining({ host: '127.0.0.1', port: 5000, outputNumber: 1, ns: '00000' })],
    });
    await closeGateway(ws);
  });

  test('encerramento normal grava a hora; reconectar limpa', async () => {
    const { ws } = await connectGateway();
    ws.send(JSON.stringify({ type: 'shutdown' }));
    const closed = await waitFor(async () => {
      const row = await db('gateway_devices').where({ id: device.id }).first('closed_by_operator_at');
      return row.closed_by_operator_at;
    });
    expect(closed).toBeInstanceOf(Date);
    await closeGateway(ws);

    const reconnected = await connectGateway();
    await waitFor(async () => {
      const row = await db('gateway_devices').where({ id: device.id }).first('closed_by_operator_at');
      return row.closed_by_operator_at === null;
    });
    await closeGateway(reconnected.ws);
  });
});
