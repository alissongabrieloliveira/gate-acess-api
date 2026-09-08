// utils/email.js nunca tinha teste unitário próprio — só era exercitado via
// jest.mock('../../src/utils/email') na integração (forgot-password.test.js),
// que mocka o módulo inteiro e por isso não cobre o comportamento interno.
// `resendApiKey`/`config/env` e o SDK `resend` são mockados via jest.doMock +
// jest.resetModules() (mesmo padrão de tests/unit/env.test.js) pra poder
// recarregar email.js do zero em cada cenário, já que `isConfigured` é
// calculado uma vez no require do módulo.
describe('utils/email#sendPasswordResetEmail', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('sem RESEND_API_KEY configurada, loga o link e não instancia o cliente Resend', async () => {
    jest.doMock('../../src/config/env', () => ({
      resendApiKey: null,
      emailFrom: 'Portaria <no-reply@localhost>',
    }));
    const sendMock = jest.fn();
    const ResendMock = jest.fn().mockImplementation(() => ({ emails: { send: sendMock } }));
    jest.doMock('resend', () => ({ Resend: ResendMock }));
    const warnSpy = jest.fn();
    const errorSpy = jest.fn();
    jest.doMock('../../src/utils/logger', () => ({ warn: warnSpy, error: errorSpy }));

    const { sendPasswordResetEmail } = require('../../src/utils/email');
    await sendPasswordResetEmail({ to: 'user@example.com', resetUrl: 'https://app.exemplo.com/reset?token=abc' });

    expect(ResendMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('RESEND_API_KEY'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('https://app.exemplo.com/reset?token=abc'));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('configurada, chama resend.emails.send com from/to/subject/html corretos', async () => {
    jest.doMock('../../src/config/env', () => ({
      resendApiKey: 're_test_key',
      emailFrom: 'Portaria <no-reply@resend.dev>',
    }));
    const sendMock = jest.fn().mockResolvedValue({ data: { id: 'email_123' }, error: null });
    const ResendMock = jest.fn().mockImplementation(() => ({ emails: { send: sendMock } }));
    jest.doMock('resend', () => ({ Resend: ResendMock }));
    jest.doMock('../../src/utils/logger', () => ({ warn: jest.fn(), error: jest.fn() }));

    const { sendPasswordResetEmail } = require('../../src/utils/email');
    await sendPasswordResetEmail({ to: 'user@example.com', resetUrl: 'https://app.exemplo.com/reset?token=abc' });

    expect(ResendMock).toHaveBeenCalledWith('re_test_key');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.from).toBe('Portaria <no-reply@resend.dev>');
    expect(payload.to).toBe('user@example.com');
    expect(payload.subject).toMatch(/Recuperação de senha/);
    expect(payload.html).toContain('https://app.exemplo.com/reset?token=abc');
  });

  test('erro devolvido pelo SDK (sem lançar) é logado, função não lança', async () => {
    // O SDK do Resend não lança em toda falha de API — muitos erros (ex.:
    // remetente/destinatário não permitido no modo de teste) voltam como
    // `{ error }` no retorno normal, não como exceção.
    jest.doMock('../../src/config/env', () => ({
      resendApiKey: 're_test_key',
      emailFrom: 'Portaria <no-reply@resend.dev>',
    }));
    const sendMock = jest.fn().mockResolvedValue({ data: null, error: { message: 'domain not verified' } });
    const ResendMock = jest.fn().mockImplementation(() => ({ emails: { send: sendMock } }));
    jest.doMock('resend', () => ({ Resend: ResendMock }));
    const errorSpy = jest.fn();
    jest.doMock('../../src/utils/logger', () => ({ warn: jest.fn(), error: errorSpy }));

    const { sendPasswordResetEmail } = require('../../src/utils/email');
    await expect(
      sendPasswordResetEmail({ to: 'user@example.com', resetUrl: 'https://app.exemplo.com/reset' })
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test('exceção lançada pelo SDK é capturada e logada, função não lança', async () => {
    jest.doMock('../../src/config/env', () => ({
      resendApiKey: 're_test_key',
      emailFrom: 'Portaria <no-reply@resend.dev>',
    }));
    const sendMock = jest.fn().mockRejectedValue(new Error('network down'));
    const ResendMock = jest.fn().mockImplementation(() => ({ emails: { send: sendMock } }));
    jest.doMock('resend', () => ({ Resend: ResendMock }));
    const errorSpy = jest.fn();
    jest.doMock('../../src/utils/logger', () => ({ warn: jest.fn(), error: errorSpy }));

    const { sendPasswordResetEmail } = require('../../src/utils/email');
    await expect(
      sendPasswordResetEmail({ to: 'user@example.com', resetUrl: 'https://app.exemplo.com/reset' })
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
