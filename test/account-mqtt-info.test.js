/**
 * airplus-account gives each MQTT client the presigned URL from startup for its first connect,
 * then a new one from the API for every reconnect. A reused URL has expired by the 50 min
 * credential refresh, and every reconnect with it times out.
 */

const fs = require('fs');

jest.mock('../lib/api', () => ({ createApiClient: jest.fn() }));
jest.mock('../lib/mqtt', () => ({ createMqttClient: jest.fn() }));
jest.mock('../lib/oauth', () => ({
  ...jest.requireActual('../lib/oauth'),
  refreshTokens: jest.fn(),
}));
const { createApiClient } = require('../lib/api');
const { createMqttClient } = require('../lib/mqtt');
const { refreshTokens } = require('../lib/oauth');
const { fakeMqttClient, createAccountNode } = require('./helpers/account-node');

const DEVICE = { id: 'dev-1', name: 'Bedroom' };

describe('airplus-account MQTT info', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  test('the first connect uses the startup URL, each reconnect fetches a new one', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    const clients = [];
    createMqttClient.mockImplementation(options => {
      const client = fakeMqttClient(options);
      clients.push(client);
      return client;
    });
    let issued = 0;
    const getMqttInfo = jest.fn(async (userId, deviceIds) =>
      deviceIds.map(id => ({ device_id: id, host: `wss://url-${++issued}` }))
    );
    createApiClient.mockReturnValue({
      listDevices: jest.fn().mockResolvedValue([DEVICE]),
      getMqttInfo,
    });
    const { node } = createAccountNode();
    await new Promise(setImmediate);
    const getInfo = clients[0].options.getMqttInfo;

    expect((await getInfo()).host).toBe('wss://url-1');
    expect((await getInfo()).host).toBe('wss://url-2');
    expect((await getInfo()).host).toBe('wss://url-3');
    expect(getMqttInfo).toHaveBeenLastCalledWith('user-1', [DEVICE.id]);

    await new Promise(resolve => node.emit('close', resolve));
  });

  test('the device is subscribed before the first connect, so a failed connect can retry', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    const clients = [];
    createMqttClient.mockImplementation(options => {
      const client = fakeMqttClient(options);
      client.connect = jest.fn(async () => {
        throw new Error('MQTT connection timeout');
      });
      clients.push(client);
      return client;
    });
    createApiClient.mockReturnValue({
      listDevices: jest.fn().mockResolvedValue([DEVICE]),
      getMqttInfo: jest.fn().mockResolvedValue([{ device_id: DEVICE.id, host: 'wss://url' }]),
    });
    const { node } = createAccountNode();
    await new Promise(setImmediate);

    expect(clients[0].subscribeDevice).toHaveBeenCalledWith(DEVICE.id);
    expect(clients[0].subscribeDevice.mock.invocationCallOrder[0]).toBeLessThan(
      clients[0].connect.mock.invocationCallOrder[0]
    );

    await new Promise(resolve => node.emit('close', resolve));
  });

  test('reconnects that need a token refresh at the same time share one refresh', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const clients = [];
    createMqttClient.mockImplementation(options => {
      const client = fakeMqttClient(options);
      clients.push(client);
      return client;
    });
    const devices = [DEVICE, { id: 'dev-2', name: 'Kids Room' }];
    createApiClient.mockReturnValue({
      listDevices: jest.fn().mockResolvedValue(devices),
      getMqttInfo: jest.fn(async (userId, deviceIds) =>
        deviceIds.map(id => ({ device_id: id, host: `wss://${id}` }))
      ),
      clearToken: jest.fn(),
    });
    const { node } = createAccountNode();
    await new Promise(setImmediate);
    await Promise.all(clients.map(client => client.options.getMqttInfo()));

    // The access token is now near expiry; every refresh returns one that is too
    const expired = Math.floor(Date.now() / 1000);
    node.credentials.expiresAt = String(expired);
    refreshTokens.mockResolvedValue({
      refresh_token: 'refresh-2',
      expires_at: expired,
      claims: () => ({ sub: 'user-1' }),
    });
    await Promise.all(clients.map(client => client.options.getMqttInfo()));

    expect(refreshTokens).toHaveBeenCalledTimes(1);

    await new Promise(resolve => node.emit('close', resolve));
  });
});
