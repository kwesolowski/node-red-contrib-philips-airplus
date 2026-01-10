module.exports = {
  testEnvironment: 'node',
  // Transform ESM modules
  transformIgnorePatterns: ['/node_modules/(?!(openid-client|oauth4webapi)/)'],
  // Mock modules that use ESM
  moduleNameMapper: {
    '^openid-client$': '<rootDir>/test/__mocks__/openid-client.js',
  },
};
