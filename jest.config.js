module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  globalSetup: '<rootDir>/tests/globalSetup.js',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  // Testes de integração batem no Postgres de teste de verdade — o padrão de
  // 5s do Jest é apertado demais pra isso.
  testTimeout: 15000,
};
