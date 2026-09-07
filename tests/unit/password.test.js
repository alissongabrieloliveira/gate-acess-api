const { hashPassword, comparePassword } = require('../../src/utils/password');

describe('utils/password', () => {
  test('hash -> compare com a senha certa retorna true', async () => {
    const hash = await hashPassword('MinhaSenh@123');
    await expect(comparePassword('MinhaSenh@123', hash)).resolves.toBe(true);
  });

  test('compare com a senha errada retorna false', async () => {
    const hash = await hashPassword('MinhaSenh@123');
    await expect(comparePassword('OutraSenha', hash)).resolves.toBe(false);
  });

  test('duas hashes da mesma senha são diferentes (salt aleatório)', async () => {
    const [first, second] = await Promise.all([hashPassword('MesmaSenha!'), hashPassword('MesmaSenha!')]);
    expect(first).not.toBe(second);
  });
});
