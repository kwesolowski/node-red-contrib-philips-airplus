/**
 * airplus-account: a failed device fetch at startup is retried with backoff.
 */

const fs = require('fs');
const EventEmitter = require('events');

jest.mock('../lib/api', () => ({ createApiClient: jest.fn() }));
jest.mock('../lib/mqtt', () => ({ createMqttClient: jest.fn() }));
jest.mock('../lib/oauth', () => ({
  ...jest.requireActual('../lib/oauth'),
  refreshTokens: jest.fn(),
}));
const { createApiClient } = require('../lib/api');
const { createMqttClient } = require('../lib/mqtt');
const { refreshTokens } = require('../lib/oauth');
const { CONNECT_RETRY_MIN_MS } = require('../lib/constants');

function fakeMqttClient(options) {
  let connected = false;
  return {
    options,
    connect: jest.fn(async () => {
      connected = true;
      options.onConnect();
    }),
    disconnect: jest.fn(() => {
      connected = false;
    }),
    subscribeDevice: jest.fn(),
    isConnected: () => connected,
  };
}

const DEVICE = { id: 'dev-1', name: 'Bedroom' };

function createAccountNode({ expiresAt } = {}) {
  let NodeConstructor;
  const RED = {
    nodes: {
      createNode(node, config) {
        Object.assign(node, new EventEmitter());
        Object.setPrototypeOf(node, EventEmitter.prototype);
        node.id = config.id;
        node.credentials = config.credentials;
        node.log = jest.fn();
        node.warn = jest.fn();
        node.error = jest.fn();
        node.status = jest.fn();
      },
      addCredentials: jest.fn(),
      registerType: jest.fn((type, ctor) => {
        NodeConstructor = ctor;
      }),
    },
    httpAdmin: { get: jest.fn(), post: jest.fn() },
  };
  require('../nodes/airplus-account')(RED);

  const node = {};
  const farFuture = String(Math.floor(Date.now() / 1000) + 24 * 3600);
  NodeConstructor.call(node, {
    id: 'account-1',
    credentials: {
      userId: 'user-1',
      refreshToken: 'refresh-1',
      expiresAt: expiresAt ?? farFuture,
    },
  });
  return node;
}

describe('airplus-account startup retry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  test('retries the device fetch after a network error and logs the cause', async () => {
    const fetchFailed = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    const listDevices = jest.fn().mockRejectedValueOnce(fetchFailed).mockResolvedValueOnce([]);
    createApiClient.mockReturnValue({ listDevices });

    const node = createAccountNode();
    await jest.advanceTimersByTimeAsync(0);

    expect(listDevices).toHaveBeenCalledTimes(1);
    expect(node.isReady()).toBe(true);
    expect(node.error).toHaveBeenCalledWith(
      'Initialization failed: fetch failed (cause: ECONNREFUSED), retrying in 30s'
    );

    await jest.advanceTimersByTimeAsync(CONNECT_RETRY_MIN_MS);

    expect(listDevices).toHaveBeenCalledTimes(2);
    expect(node.log).toHaveBeenCalledWith('Fetched 0 device(s)');
  });

  function close(node) {
    return new Promise(resolve => node.emit('close', resolve));
  }

  test('a fetch that fails after close does not schedule a retry', async () => {
    let rejectFetch;
    const listDevices = jest.fn(
      () =>
        new Promise((_, reject) => {
          rejectFetch = reject;
        })
    );
    createApiClient.mockReturnValue({ listDevices });

    const node = createAccountNode();
    await jest.advanceTimersByTimeAsync(0);
    await close(node);
    rejectFetch(new TypeError('fetch failed'));
    await jest.advanceTimersByTimeAsync(CONNECT_RETRY_MIN_MS * 4);

    expect(listDevices).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('close cancels a pending retry', async () => {
    const listDevices = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    createApiClient.mockReturnValue({ listDevices });

    const node = createAccountNode();
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(1);

    await close(node);
    await jest.advanceTimersByTimeAsync(CONNECT_RETRY_MIN_MS * 4);

    expect(listDevices).toHaveBeenCalledTimes(1);
  });

  test('after a failed start the retry connects MQTT and dependents get state', async () => {
    const clients = [];
    createMqttClient.mockImplementation(options => {
      const client = fakeMqttClient(options);
      clients.push(client);
      return client;
    });
    createApiClient.mockReturnValue({
      listDevices: jest
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce([DEVICE]),
      getMqttInfo: jest.fn().mockResolvedValue([{ device_id: DEVICE.id }]),
    });

    const node = createAccountNode();
    await jest.advanceTimersByTimeAsync(0);
    expect(node.isConnected(DEVICE.id)).toBeFalsy();

    // A dependent (airplus-status) subscribes when the account emits 'connected' for its device
    const onState = jest.fn();
    node.on('connected', deviceId => {
      if (deviceId === DEVICE.id) node.subscribe(DEVICE.id, onState);
    });
    await jest.advanceTimersByTimeAsync(CONNECT_RETRY_MIN_MS);

    expect(clients).toHaveLength(1);
    expect(clients[0].connect).toHaveBeenCalled();
    expect(node.isConnected(DEVICE.id)).toBe(true);

    clients[0].options.onStateChange(DEVICE.id, { pwr: 1 }, 'reported');
    expect(onState).toHaveBeenCalled();
  });

  test('a revoked token stops the retries', async () => {
    refreshTokens.mockRejectedValue({ error: 'invalid_grant', message: 'grant revoked' });
    const listDevices = jest.fn();
    createApiClient.mockReturnValue({ listDevices });

    const node = createAccountNode({ expiresAt: '1' });
    await jest.advanceTimersByTimeAsync(0);

    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(listDevices).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    expect(node.error).toHaveBeenCalledWith('Initialization failed: grant revoked');
  });

  test('MQTT clients created after close are disconnected', async () => {
    const clients = [];
    createMqttClient.mockImplementation(options => {
      const client = fakeMqttClient(options);
      clients.push(client);
      return client;
    });
    let resolveMqttInfo;
    createApiClient.mockReturnValue({
      listDevices: jest.fn().mockResolvedValue([DEVICE]),
      getMqttInfo: jest.fn(
        () =>
          new Promise(resolve => {
            resolveMqttInfo = resolve;
          })
      ),
    });

    const node = createAccountNode();
    await jest.advanceTimersByTimeAsync(0);
    await close(node);
    resolveMqttInfo([{ device_id: DEVICE.id }]);
    await jest.advanceTimersByTimeAsync(0);

    expect(clients).toHaveLength(1);
    expect(clients[0].disconnect).toHaveBeenCalled();
    expect(node.isConnected(DEVICE.id)).toBeFalsy();
  });
});
