const {
  registerConnection,
  removeConnection,
  getOfflineSince,
} = require('../../src/gatewayWs/connectionRegistry');

describe('connectionRegistry#getOfflineSince', () => {
  test('nunca conectou desde o boot -> conta desde o boot do processo', () => {
    const since = getOfflineSince(9001);
    expect(since).toBeInstanceOf(Date);
    expect(since.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test('conectado -> null; desconectado -> hora da queda', () => {
    const ws = {};
    registerConnection(9002, ws);
    expect(getOfflineSince(9002)).toBeNull();

    const before = Date.now();
    removeConnection(9002, ws);
    expect(getOfflineSince(9002).getTime()).toBeGreaterThanOrEqual(before);
  });

  test('close tardio da conexão antiga não marca queda depois da reconexão', () => {
    const oldWs = {};
    const newWs = {};
    registerConnection(9003, oldWs);
    registerConnection(9003, newWs);
    removeConnection(9003, oldWs);
    expect(getOfflineSince(9003)).toBeNull();
  });
});
