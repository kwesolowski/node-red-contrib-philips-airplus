module.exports = {
  testEnvironment: 'node',
  // No test may see the real CLI credentials file
  globalSetup: '<rootDir>/test/setup-home.js',
  globalTeardown: '<rootDir>/test/teardown-home.js',
  // Transform ESM modules
  transformIgnorePatterns: ['/node_modules/(?!(openid-client|oauth4webapi)/)'],
  // Mock modules that use ESM
  moduleNameMapper: {
    '^openid-client$': '<rootDir>/test/__mocks__/openid-client.js',
  },
};
