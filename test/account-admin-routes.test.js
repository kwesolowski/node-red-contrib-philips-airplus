/**
 * Every airplus admin route needs an editor permission: GET routes airplus-account.read,
 * POST routes airplus-account.write. Node-RED grants *.read to read-only users, so the GET
 * route that returns the refresh token needs write.
 */

const fs = require('fs');

jest.mock('../lib/api', () => ({ createApiClient: jest.fn() }));
jest.mock('../lib/mqtt', () => ({ createMqttClient: jest.fn() }));
const { createApiClient } = require('../lib/api');
const { createMqttClient } = require('../lib/mqtt');
const { fakeMqttClient, createAccountNode } = require('./helpers/account-node');

describe('airplus admin routes', () => {
  let account;

  beforeAll(async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    createMqttClient.mockImplementation(fakeMqttClient);
    createApiClient.mockReturnValue({
      listDevices: jest.fn().mockResolvedValue([]),
      getMqttInfo: jest.fn().mockResolvedValue([]),
    });
    account = createAccountNode();
    await new Promise(setImmediate);
  });

  afterAll(async () => {
    await new Promise(resolve => account.node.emit('close', resolve));
    jest.restoreAllMocks();
  });

  const WRITE_GETS = ['/philips-airplus/export-credentials'];

  test('GET routes need the read permission, credential export needs write', () => {
    expect(account.routes.size).toBeGreaterThan(0);
    account.routes.forEach((handlers, path) => {
      const scope = WRITE_GETS.includes(path) ? 'write' : 'read';
      expect([path, handlers[0]]).toEqual([path, { permission: `airplus-account.${scope}` }]);
    });
    WRITE_GETS.forEach(path => expect(account.routes.has(path)).toBe(true));
  });

  test('POST routes need the write permission', () => {
    expect(account.posts.size).toBeGreaterThan(0);
    account.posts.forEach((handlers, path) => {
      expect([path, handlers[0]]).toEqual([path, { permission: 'airplus-account.write' }]);
    });
  });
});
