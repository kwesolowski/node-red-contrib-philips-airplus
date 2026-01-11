/**
 * Tests for MQTT reconnection logic and token refresh scenarios.
 * These tests cover edge cases that caused the "Bedroom stuck waiting" issue.
 */

const { createMqttClient } = require('../lib/mqtt');
const EventEmitter = require('events');

// Mock MQTT client
class MockMqttClient extends EventEmitter {
  constructor() {
    super();
    this.subscriptions = [];
    this.published = [];
    this.ended = false;
    this.connected = false;
  }

  subscribe(topic, opts) {
    this.subscriptions.push(topic);
  }

  unsubscribe(topic) {
    this.subscriptions = this.subscriptions.filter(t => t !== topic);
  }

  publish(topic, payload, opts) {
    this.published.push({ topic, payload, opts });
  }

  end(force) {
    this.ended = true;
    this.connected = false;
    setTimeout(() => this.emit('close'), 5);
  }

  simulateConnect() {
    this.connected = true;
    this.emit('connect');
  }

  simulateDisconnect() {
    this.connected = false;
    this.emit('close');
  }

  simulateError(err) {
    this.emit('error', err);
  }
}

// Mock MQTT library
class MockMqttLib {
  constructor() {
    this.clients = [];
  }

  connect(url, opts) {
    const client = new MockMqttClient();
    this.clients.push(client);
    return client;
  }

  getLastClient() {
    return this.clients[this.clients.length - 1];
  }

  getAllClients() {
    return this.clients;
  }
}

describe('MQTT Reconnection Logic', () => {
  let mockMqttLib;
  let client;
  let getMqttInfoCallCount;
  let mqttInfo;

  beforeEach(() => {
    jest.useFakeTimers();
    mockMqttLib = new MockMqttLib();
    getMqttInfoCallCount = 0;
    mqttInfo = {
      host: 'wss://mqtt.example.com',
      client_id: 'test-client',
      device_id: 'dev-bedroom',
    };
  });

  afterEach(() => {
    if (client) {
      client.disconnect();
    }
    jest.useRealTimers();
  });

  describe('Automatic Reconnection After Disconnect', () => {
    it('should automatically reconnect after unexpected disconnect', async () => {
      const onConnect = jest.fn();
      const onDisconnect = jest.fn();

      client = createMqttClient({
        getMqttInfo: async () => {
          getMqttInfoCallCount++;
          return mqttInfo;
        },
        onConnect,
        onDisconnect,
        mqttLib: mockMqttLib,
      });

      // Initial connection
      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(10);
      mockMqttLib.getLastClient().simulateConnect();
      await connectPromise;

      client.subscribeDevice('dev-bedroom');
      expect(onConnect).toHaveBeenCalledTimes(1);

      // Simulate unexpected disconnect (e.g., network issue)
      mockMqttLib.getLastClient().simulateDisconnect();
      await jest.advanceTimersByTimeAsync(10);
      expect(onDisconnect).toHaveBeenCalledTimes(1);

      // Should schedule reconnect with exponential backoff
      // First retry: base delay (1000ms by default)
      await jest.advanceTimersByTimeAsync(1000);
      mockMqttLib.getLastClient().simulateConnect();
      await jest.advanceTimersByTimeAsync(10);

      expect(onConnect).toHaveBeenCalledTimes(2);
      expect(getMqttInfoCallCount).toBe(2); // Called for initial connect + reconnect
    });

    it('should use exponential backoff for repeated disconnects', async () => {
      const onConnect = jest.fn();
      const onDisconnect = jest.fn();

      client = createMqttClient({
        getMqttInfo: async () => mqttInfo,
        onConnect,
        onDisconnect,
        mqttLib: mockMqttLib,
      });

      // Initial connection
      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(10);
      mockMqttLib.getLastClient().simulateConnect();
      await connectPromise;
      client.subscribeDevice('dev-bedroom');

      // First disconnect - should retry after 1000ms
      mockMqttLib.getLastClient().simulateDisconnect();
      await jest.advanceTimersByTimeAsync(500);
      expect(mockMqttLib.getAllClients()).toHaveLength(1); // No new connection yet

      await jest.advanceTimersByTimeAsync(500);
      mockMqttLib.getLastClient().simulateConnect();
      await jest.advanceTimersByTimeAsync(10);

      // Second disconnect - should retry after 2000ms (exponential)
      mockMqttLib.getLastClient().simulateDisconnect();
      await jest.advanceTimersByTimeAsync(1000);
      expect(mockMqttLib.getAllClients()).toHaveLength(2); // Still waiting

      await jest.advanceTimersByTimeAsync(1000);
      mockMqttLib.getLastClient().simulateConnect();
      await jest.advanceTimersByTimeAsync(10);

      expect(onConnect).toHaveBeenCalledTimes(3); // Initial + 2 reconnects
    });

    it('should not reconnect if disconnect was intentional', async () => {
      client = createMqttClient({
        getMqttInfo: async () => mqttInfo,
        mqttLib: mockMqttLib,
      });

      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(10);
      mockMqttLib.getLastClient().simulateConnect();
      await connectPromise;

      client.subscribeDevice('dev-bedroom');

      // Intentional disconnect
      client.disconnect();
      await jest.advanceTimersByTimeAsync(10);

      // Should not attempt reconnect even after backoff period
      await jest.advanceTimersByTimeAsync(5000);
      expect(mockMqttLib.getAllClients()).toHaveLength(1); // No new client created
    });
  });

  describe('Token Refresh Triggering Reconnection', () => {
    it('should fetch new MQTT credentials when reconnecting', async () => {
      const getMqttInfo = jest.fn(async () => ({
        host: 'wss://mqtt.example.com',
        client_id: `client-${getMqttInfo.mock.calls.length}`,
        device_id: 'dev-bedroom',
      }));

      client = createMqttClient({
        getMqttInfo,
        mqttLib: mockMqttLib,
      });

      // Initial connection
      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(10);
      mockMqttLib.getLastClient().simulateConnect();
      await connectPromise;

      expect(getMqttInfo).toHaveBeenCalledTimes(1);
      const firstClientId = mockMqttLib.getLastClient();

      // Simulate disconnect
      mockMqttLib.getLastClient().simulateDisconnect();
      await jest.advanceTimersByTimeAsync(1000);

      // Reconnect should fetch new MQTT info (with fresh token)
      mockMqttLib.getLastClient().simulateConnect();
      await jest.advanceTimersByTimeAsync(10);

      expect(getMqttInfo).toHaveBeenCalledTimes(2);
      expect(mockMqttLib.getAllClients()).toHaveLength(2);
      expect(mockMqttLib.getAllClients()[0]).toBe(firstClientId);
    });

    it('should handle getMqttInfo failure during reconnect', async () => {
      let shouldFail = false;
      const onError = jest.fn();

      client = createMqttClient({
        getMqttInfo: async () => {
          if (shouldFail) {
            throw new Error('Token refresh failed');
          }
          return mqttInfo;
        },
        onError,
        mqttLib: mockMqttLib,
      });

      // Initial connection succeeds
      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(10);
      mockMqttLib.getLastClient().simulateConnect();
      await connectPromise;

      // Disconnect
      mockMqttLib.getLastClient().simulateDisconnect();
      await jest.advanceTimersByTimeAsync(10);

      // Make getMqttInfo fail on reconnect
      shouldFail = true;
      await jest.advanceTimersByTimeAsync(1000);

      // Should have called onError and scheduled another retry
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Token refresh failed' }));

      // Allow success on next attempt
      shouldFail = false;
      await jest.advanceTimersByTimeAsync(2000); // Next backoff
      mockMqttLib.getLastClient().simulateConnect();
      await jest.advanceTimersByTimeAsync(10);

      expect(client.isConnected()).toBe(true);
    });
  });

  describe('Per-Device Connection State', () => {
    it('should track connection state per device', async () => {
      client = createMqttClient({
        getMqttInfo: async () => ({
          host: 'wss://mqtt.example.com',
          client_id: 'multi-device-client',
          device_id: 'all-devices',
        }),
        mqttLib: mockMqttLib,
      });

      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(10);
      mockMqttLib.getLastClient().simulateConnect();
      await connectPromise;

      // Subscribe multiple devices
      client.subscribeDevice('dev-bedroom');
      client.subscribeDevice('dev-living');
      client.subscribeDevice('dev-kids');

      expect(client.getSubscribedDevices()).toEqual(['dev-bedroom', 'dev-living', 'dev-kids']);

      // Disconnect should affect all devices
      mockMqttLib.getLastClient().simulateDisconnect();
      await jest.advanceTimersByTimeAsync(10);

      expect(client.isConnected()).toBe(false);

      // Reconnect should restore all subscriptions
      await jest.advanceTimersByTimeAsync(1000);
      mockMqttLib.getLastClient().simulateConnect();
      await jest.advanceTimersByTimeAsync(10);

      expect(client.getSubscribedDevices()).toEqual(['dev-bedroom', 'dev-living', 'dev-kids']);
    });

    it('should only reconnect if there are subscribed devices', async () => {
      const onConnect = jest.fn();

      client = createMqttClient({
        getMqttInfo: async () => mqttInfo,
        onConnect,
        mqttLib: mockMqttLib,
      });

      // Connect but don't subscribe any devices
      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(10);
      mockMqttLib.getLastClient().simulateConnect();
      await connectPromise;

      expect(onConnect).toHaveBeenCalledTimes(1);

      // Disconnect
      mockMqttLib.getLastClient().simulateDisconnect();
      await jest.advanceTimersByTimeAsync(10);

      // Should NOT automatically reconnect since no devices subscribed
      await jest.advanceTimersByTimeAsync(5000);
      expect(mockMqttLib.getAllClients()).toHaveLength(1);
      expect(onConnect).toHaveBeenCalledTimes(1); // Still just the initial connect
    });
  });

  describe('Connection Timeout Handling', () => {
    it('should handle connection timeout errors', async () => {
      const onError = jest.fn();
      let connectionAttempts = 0;

      client = createMqttClient({
        getMqttInfo: async () => mqttInfo,
        onError,
        mqttLib: mockMqttLib,
      });

      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(10);
      mockMqttLib.getLastClient().simulateConnect();
      await connectPromise;

      client.subscribeDevice('dev-bedroom');

      // Simulate connection timeout (disconnect without reconnect signal)
      mockMqttLib.getLastClient().simulateError(new Error('MQTT connection timeout'));
      mockMqttLib.getLastClient().simulateDisconnect();
      await jest.advanceTimersByTimeAsync(10);

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'MQTT connection timeout' }));

      // Should attempt reconnect
      await jest.advanceTimersByTimeAsync(1000);
      mockMqttLib.getLastClient().simulateConnect();
      await jest.advanceTimersByTimeAsync(10);

      expect(client.isConnected()).toBe(true);
    });
  });
});
