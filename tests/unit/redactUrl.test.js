const { redactUrl, redactQuery } = require('../../src/utils/redactUrl');

describe('redactUrl — dados pessoais fora do log', () => {
  test('mascara busca por CPF, nome e placa', () => {
    expect(redactUrl('/api/v1/people?search=52998224725&page=2')).toBe('/api/v1/people?search=[redacted]&page=2');
    expect(redactUrl('/api/v1/people?cpf=529.982.247-25')).toBe('/api/v1/people?cpf=[redacted]');
    expect(redactUrl('/api/v1/vehicles?plate=ABC1D23&vehicleType=2')).toBe('/api/v1/vehicles?plate=[redacted]&vehicleType=2');
  });

  test('parâmetro desconhecido também é mascarado (lista de liberados)', () => {
    expect(redactUrl('/api/v1/x?novoCampo=Maria')).toBe('/api/v1/x?novoCampo=[redacted]');
  });

  test('mantém ids, paginação e datas', () => {
    const url = '/api/v1/access-logs?from=2026-09-20T03%3A00%3A00.000Z&limit=5&entryGateId=5';
    expect(redactUrl(url)).toBe(url);
    expect(redactUrl('/api/v1/health')).toBe('/api/v1/health');
  });

  test('redactQuery faz o mesmo no objeto de query', () => {
    expect(redactQuery({ search: 'Maria', limit: '5' })).toEqual({ search: '[redacted]', limit: '5' });
    expect(redactQuery(undefined)).toBeUndefined();
  });
});
