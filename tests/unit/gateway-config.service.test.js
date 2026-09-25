jest.mock('../../src/modules/gateway-config/gateway-config.repository');
jest.mock('../../src/gatewayWs/gatewayWs', () => ({ sendOutputTestToGateway: jest.fn() }));

const repository = require('../../src/modules/gateway-config/gateway-config.repository');
const { sendOutputTestToGateway } = require('../../src/gatewayWs/gatewayWs');
const AppError = require('../../src/utils/AppError');
const service = require('../../src/modules/gateway-config/gateway-config.service');

const admin = { userId: 1, companyId: 1, rules: 1 };

beforeEach(() => {
  jest.clearAllMocks();
  repository.findOutputByIdAndCompany.mockResolvedValue({ id: 5, output_number: 3, gateway_device_id: 7, company_id: 1 });
  sendOutputTestToGateway.mockResolvedValue({ ok: true });
});

describe('gateway-config.service testOutput (teste de saída avulsa)', () => {
  test('pulso manda só a saída pedida, com o tempo escolhido', async () => {
    const result = await service.testOutput(admin, 5, { mode: 'pulse', seconds: 2 });

    expect(repository.findOutputByIdAndCompany).toHaveBeenCalledWith(5, 1);
    expect(sendOutputTestToGateway).toHaveBeenCalledWith(7, { outputId: 5, mode: 'pulse', seconds: 2 }, expect.any(Number));
    expect(result).toEqual({ outputId: 5, outputNumber: 3, mode: 'pulse', seconds: 2 });
  });

  test('liga/desliga não manda tempo de pulso', async () => {
    await service.testOutput(admin, 5, { mode: 'on', seconds: 3 });

    expect(sendOutputTestToGateway).toHaveBeenCalledWith(7, { outputId: 5, mode: 'on', seconds: undefined }, expect.any(Number));
  });

  test.each([
    [{ mode: 'toggle' }],
    [{ mode: 'pulse' }],
    [{ mode: 'pulse', seconds: 0 }],
    [{ mode: 'pulse', seconds: 11 }],
    [{ mode: 'pulse', seconds: 1.5 }],
  ])('recusa payload inválido %j com 400', async (payload) => {
    await expect(service.testOutput(admin, 5, payload)).rejects.toMatchObject({ statusCode: 400 });
    expect(sendOutputTestToGateway).not.toHaveBeenCalled();
  });

  test('saída de outra empresa / inexistente dá 404', async () => {
    repository.findOutputByIdAndCompany.mockResolvedValue(undefined);

    await expect(service.testOutput(admin, 99, { mode: 'on' })).rejects.toMatchObject({ statusCode: 404 });
    expect(sendOutputTestToGateway).not.toHaveBeenCalled();
  });

  test('falha reportada pelo gateway vira 502', async () => {
    sendOutputTestToGateway.mockResolvedValue({ ok: false, error: 'Sem conexão com o controlador' });

    await expect(service.testOutput(admin, 5, { mode: 'off' })).rejects.toMatchObject({ statusCode: 502 });
  });

  test('timeout do gateway (ex.: gateway desatualizado) vira 504', async () => {
    sendOutputTestToGateway.mockRejectedValue(new Error('Tempo esgotado aguardando resposta do gateway'));

    await expect(service.testOutput(admin, 5, { mode: 'on' })).rejects.toMatchObject({ statusCode: 504 });
  });

  test('gateway offline mantém o 503', async () => {
    sendOutputTestToGateway.mockRejectedValue(new AppError('Gateway do cliente está offline', 503));

    await expect(service.testOutput(admin, 5, { mode: 'on' })).rejects.toMatchObject({ statusCode: 503 });
  });
});
