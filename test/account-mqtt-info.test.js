/**
 * airplus-account gives each MQTT client the presigned URL from startup for its first connect,
 * then a new one from the API for every reconnect. A reused URL has expired by the 50 min
 * credential refresh, and every reconnect with it times out.
 */

const fs = require('fs');

jest.mock('../lib/api', () => ({ createApiClient: jest.fn() }));
jest.mock('../lib/mqtt', () => ({ createMqttClient: jest.fn() }));
const { createApiClient } = require('../lib/api');
const { createMqttClient } = require('../lib/mqtt');
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
});
