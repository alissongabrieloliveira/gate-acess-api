jest.mock('../../src/modules/gate-directions/gate-directions.repository');
jest.mock('../../src/gatewayWs/gatewayWs', () => ({ sendCommandToGateway: jest.fn() }));
jest.mock('../../src/utils/withAuthTransaction', () => jest.fn((auth, fn) => fn({})));

const repository = require('../../src/modules/gate-directions/gate-directions.repository');
const { sendCommandToGateway } = require('../../src/gatewayWs/gatewayWs');
const RULES = require('../../src/config/rules');
const service = require('../../src/modules/gate-directions/gate-directions.service');

const operator = { userId: 2, companyId: 1, rules: 0 };
const admin = { userId: 1, companyId: 1, rules: RULES.ADMIN };

// Estado "do banco" compartilhado entre as chamadas, pra simular 2 cliques
// seguidos enxergando o que o primeiro gravou.
let state;

function rows() {
  return [1, 3].map((outputNumber) => ({
    id: outputNumber,
    output_number: outputNumber,
    direction: 'ENTRY',
    gateway_device_id: 7,
    current_state: state,
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  state = 'OFF';
  repository.findByDirectionAndCompany.mockImplementation(async () => rows());
  repository.updateStateByIds.mockImplementation(async (ids, companyId, newState) => {
    state = newState;
    return rows();
  });
  sendCommandToGateway.mockResolvedValue({ ok: true });
});

describe('gate-directions.service setDirectionState (cancelas de impulso)', () => {
  test('abrir cancela fechada manda 1 pulso com as 2 saídas juntas', async () => {
    const result = await service.setDirectionState(operator, 'entry', 'open');

    expect(sendCommandToGateway).toHaveBeenCalledTimes(1);
    expect(sendCommandToGateway).toHaveBeenCalledWith(7, { outputIds: [1, 3], action: 'open' }, expect.any(Number));
    expect(result.currentState).toBe('ON');
  });

  test('abrir cancela já aberta não manda pulso (senão fecharia)', async () => {
    state = 'ON';

    const result = await service.setDirectionState(operator, 'entry', 'open');

    expect(sendCommandToGateway).not.toHaveBeenCalled();
    expect(repository.updateStateByIds).not.toHaveBeenCalled();
    expect(result.currentState).toBe('ON');
  });

  test('2 cliques "abrir" simultâneos viram 1 pulso só', async () => {
    const results = await Promise.all([
      service.setDirectionState(operator, 'entry', 'open'),
      service.setDirectionState(operator, 'entry', 'open'),
    ]);

    expect(sendCommandToGateway).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.currentState)).toEqual(['ON', 'ON']);
  });

  test('admin com force pulsa mesmo com o estado presumido igual ao pedido', async () => {
    state = 'ON';

    await service.setDirectionState(admin, 'entry', 'open', { force: true });

    expect(sendCommandToGateway).toHaveBeenCalledTimes(1);
  });

  test('force é ignorado para quem não é admin', async () => {
    state = 'ON';

    await service.setDirectionState(operator, 'entry', 'open', { force: true });

    expect(sendCommandToGateway).not.toHaveBeenCalled();
  });

  test('falha do gateway não altera o estado presumido e libera a fila', async () => {
    sendCommandToGateway.mockResolvedValueOnce({ ok: false, error: 'Timeout' });

    await expect(service.setDirectionState(operator, 'entry', 'open')).rejects.toMatchObject({ statusCode: 502 });
    expect(state).toBe('OFF');

    await service.setDirectionState(operator, 'entry', 'open');
    expect(state).toBe('ON');
  });
});
