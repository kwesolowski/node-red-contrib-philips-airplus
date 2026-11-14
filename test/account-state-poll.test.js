/**
 * airplus-account: periodic shadow get per device (60 min +/- 15 min) and the reportedAt
 * times passed to status subscribers.
 */

const fs = require('fs');

jest.mock('../lib/api', () => ({ createApiClient: jest.fn() }));
jest.mock('../lib/mqtt', () => ({ createMqttClient: jest.fn() }));
const { createApiClient } = require('../lib/api');
const { createMqttClient } = require('../lib/mqtt');
const { STATE_POLL_INTERVAL_MS, STATE_POLL_JITTER_MS } = require('../lib/constants');
const { fakeMqttClient, createAccountNode } = require('./helpers/account-node');

const DEVICE = { id: 'dev-1', name: 'Bedroom' };
const MINUTE = 60 * 1000;

async function connectedAccount({ listening = true } = {}) {
  const clients = [];
  createMqttClient.mockImplementation(options => {
    const client = fakeMqttClient(options);
    clients.push(client);
    return client;
  });
  createApiClient.mockReturnValue({
    listDevices: jest.fn().mockResolvedValue([DEVICE]),
    getMqttInfo: jest.fn().mockResolvedValue([{ device_id: DEVICE.id }]),
  });
  const { node } = createAccountNode();
  await jest.advanceTimersByTimeAsync(0);
  const client = clients[0];
  if (listening) {
    node.subscribe(DEVICE.id, jest.fn());
    // A known status stops the one-off initial get, so only periodic gets are counted
    client.options.onStateChange(DEVICE.id, { D03125: 55 }, 'reported', {});
  }
  return { node, client };
}

function close(node) {
  return new Promise(resolve => node.emit('close', resolve));
}

describe('airplus-account periodic state request', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  test('the constants give 45 to 75 minutes', () => {
    expect(STATE_POLL_INTERVAL_MS - STATE_POLL_JITTER_MS).toBe(45 * MINUTE);
    expect(STATE_POLL_INTERVAL_MS + STATE_POLL_JITTER_MS).toBe(75 * MINUTE);
  });

  test.each([
    [0, 45],
    [0.5, 60],
    [0.999999, 75],
  ])('with random %p the next get comes after %p min, then again', async (random, minutes) => {
    jest.spyOn(Math, 'random').mockReturnValue(random);
    const { client } = await connectedAccount();

    await jest.advanceTimersByTimeAsync(minutes * MINUTE - 1000);
    expect(client.getDeviceState).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1000);
    expect(client.getDeviceState).toHaveBeenCalledWith(DEVICE.id);

    await jest.advanceTimersByTimeAsync(minutes * MINUTE);
    expect(client.getDeviceState).toHaveBeenCalledTimes(2);
  });

  test('a failed get warns and the next one is still scheduled', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const { node, client } = await connectedAccount();
    client.getDeviceState.mockRejectedValueOnce(new Error('Request timeout'));

    await jest.advanceTimersByTimeAsync(60 * MINUTE);
    expect(node.warn).toHaveBeenCalledWith(
      'Periodic state request for Bedroom failed: Request timeout'
    );

    await jest.advanceTimersByTimeAsync(60 * MINUTE);
    expect(client.getDeviceState).toHaveBeenCalledTimes(2);
  });

  test('the 50 min credential reconnect does not move the schedule', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.999999);
    const { client } = await connectedAccount();

    await jest.advanceTimersByTimeAsync(50 * MINUTE);
    client.options.onDisconnect();
    client.options.onConnect();
    await jest.advanceTimersByTimeAsync(25 * MINUTE);
    expect(client.getDeviceState).toHaveBeenCalledTimes(1);
  });

  test('a get is skipped while disconnected; the schedule goes on', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const { client } = await connectedAccount();

    client.disconnect();
    client.options.onDisconnect();
    await jest.advanceTimersByTimeAsync(60 * MINUTE);
    expect(client.getDeviceState).not.toHaveBeenCalled();

    await client.connect();
    await jest.advanceTimersByTimeAsync(60 * MINUTE);
    expect(client.getDeviceState).toHaveBeenCalledTimes(1);
  });

  test('no get while no status node listens to the device', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const { client } = await connectedAccount({ listening: false });

    await jest.advanceTimersByTimeAsync(120 * MINUTE);
    expect(client.getDeviceState).not.toHaveBeenCalled();
  });

  test('close leaves no poll timer behind', async () => {
    const { node } = await connectedAccount({ listening: false });
    await close(node);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('airplus-account reportedAt', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  test('subscribers get per-metric report times, merged across messages', async () => {
    const { node, client } = await connectedAccount();
    const onState = jest.fn();
    node.subscribe(DEVICE.id, onState);

    client.options.onStateChange(DEVICE.id, { D03125: 55, D03224: 229 }, 'reported', {
      D03125: { timestamp: 100 },
      D03224: { timestamp: 100 },
    });
    client.options.onStateChange(DEVICE.id, { D03125: 56 }, 'reported', {
      D03125: { timestamp: 200 },
    });

    const [status, type, reportedAt] = onState.mock.calls[1];
    expect(type).toBe('reported');
    expect(status).toMatchObject({ humidity: 56, temperature: 22.9 });
    expect(reportedAt).toEqual({ humidity: 200000, temperature: 100000 });
  });

  test('delta metadata does not change report times', async () => {
    const { node, client } = await connectedAccount();
    const onState = jest.fn();
    node.subscribe(DEVICE.id, onState);

    client.options.onStateChange(DEVICE.id, { D03125: 55 }, 'reported', {
      D03125: { timestamp: 100 },
    });
    client.options.onStateChange(DEVICE.id, { D03125: 57 }, 'delta', {
      D03125: { timestamp: 300 },
    });

    expect(onState.mock.calls[1][2]).toEqual({ humidity: 100000 });
  });

  test('a subscriber that changes its reportedAt does not change the next one', async () => {
    const { node, client } = await connectedAccount();
    node.subscribe(DEVICE.id, (status, type, reportedAt) => delete reportedAt.humidity);
    const onState = jest.fn();
    node.subscribe(DEVICE.id, onState);

    client.options.onStateChange(DEVICE.id, { D03125: 55 }, 'reported', {
      D03125: { timestamp: 100 },
    });
    client.options.onStateChange(DEVICE.id, { D03224: 229 }, 'reported', {
      D03224: { timestamp: 200 },
    });

    expect(onState.mock.calls[1][2]).toEqual({ humidity: 100000, temperature: 200000 });
  });
});
