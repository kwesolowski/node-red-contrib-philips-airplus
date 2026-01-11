/**
 * Tests for AWS IoT MQTT module.
 */

const { createMqttClient, formatTopic } = require('../lib/mqtt');
const EventEmitter = require('events');

// Mock MQTT client
class MockMqttClient extends EventEmitter {
  constructor() {
    super();
    this.subscriptions = [];
    this.published = [];
    this.ended = false;
  }

  subscribe(topic, _opts) {
    this.subscriptions.push(topic);
  }

  unsubscribe(topic) {
    this.subscriptions = this.subscriptions.filter(t => t !== topic);
  }

  publish(topic, payload, opts) {
    this.published.push({ topic, payload, opts });
  }

  end(_force) {
    this.ended = true;
    this.emit('close');
  }

  // Helper to simulate connection
  simulateConnect() {
    this.emit('connect');
  }

  // Helper to simulate message
  simulateMessage(topic, payload) {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.emit('message', topic, Buffer.from(data));
  }

  // Helper to simulate disconnect
  simulateDisconnect() {
    this.emit('close');
  }

  // Helper to simulate error
  simulateError(err) {
    this.emit('error', err);
  }
}

function createMockMqttLib() {
  let lastClient = null;
  return {
    connect: jest.fn((url, opts) => {
      lastClient = new MockMqttClient();
      lastClient.url = url;
      lastClient.opts = opts;
      return lastClient;
    }),
    getLastClient: () => lastClient,
  };
}

describe('mqtt', () => {
  describe('formatTopic', () => {
    it('replaces deviceId placeholder', () => {
      const result = formatTopic('$aws/things/{deviceId}/shadow/get', 'dev-123');
      expect(result).toBe('$aws/things/dev-123/shadow/get');
    });
  });

  describe('createMqttClient', () => {
    let mockMqttLib;
    let client;

    beforeEach(() => {
      mockMqttLib = createMockMqttLib();
    });

    afterEach(() => {
      if (client) {
        client.disconnect();
      }
    });

    it('connects with presigned WebSocket URL', async () => {
      client = createMqttClient({
        getMqttInfo: () =>
          Promise.resolve({
            host: 'wss://mqtt.example.com/mqtt?auth=sig',
            client_id: 'client-123',
          }),
        mqttLib: mockMqttLib,
      });

      const connectPromise = client.connect();
      setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
      await connectPromise;

      expect(mockMqttLib.connect).toHaveBeenCalledWith(
        'wss://mqtt.example.com/mqtt?auth=sig',
        expect.objectContaining({
          clientId: 'client-123',
        })
      );
    });

    it('calls onConnect when connected', async () => {
      const onConnect = jest.fn();
      client = createMqttClient({
        getMqttInfo: () => Promise.resolve({ host: 'wss://mqtt.example.com', client_id: 'c' }),
        onConnect,
        mqttLib: mockMqttLib,
      });

      const connectPromise = client.connect();
      setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
      await connectPromise;

      expect(onConnect).toHaveBeenCalled();
      expect(client.isConnected()).toBe(true);
    });

    it('subscribes to AWS IoT shadow topics for authorized device', async () => {
      client = createMqttClient({
        getMqttInfo: () =>
          Promise.resolve({
            host: 'wss://mqtt.example.com',
            client_id: 'c',
            device_id: 'dev-123',
          }),
        mqttLib: mockMqttLib,
      });

      const connectPromise = client.connect();
      setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
      await connectPromise;

      client.subscribeDevice('dev-123');

      const subs = mockMqttLib.getLastClient().subscriptions;
      expect(subs).toContain('$aws/things/dev-123/shadow/get/accepted');
      expect(subs).toContain('$aws/things/dev-123/shadow/get/rejected');
      expect(subs).toContain('$aws/things/dev-123/shadow/update/accepted');
      expect(subs).toContain('$aws/things/dev-123/shadow/update/rejected');
      expect(subs).toContain('$aws/things/dev-123/shadow/update/delta');
    });

    it('skips subscription for unauthorized devices', async () => {
      client = createMqttClient({
        getMqttInfo: () =>
          Promise.resolve({
            host: 'wss://mqtt.example.com',
            client_id: 'c',
            device_id: 'dev-123',
          }),
        mqttLib: mockMqttLib,
      });

      const connectPromise = client.connect();
      setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
      await connectPromise;

      // Try to subscribe to a different device
      client.subscribeDevice('dev-456');

      // Should not have subscribed to dev-456 topics
      const subs = mockMqttLib.getLastClient().subscriptions;
      expect(subs).not.toContain('$aws/things/dev-456/shadow/get/accepted');
      // But the device is tracked for future use
      expect(client.getSubscribedDevices()).toContain('dev-456');
    });

    it('publishes to shadow/get to request state', async () => {
      client = createMqttClient({
        getMqttInfo: () =>
          Promise.resolve({
            host: 'wss://mqtt.example.com',
            client_id: 'c',
            device_id: 'dev-123',
          }),
        mqttLib: mockMqttLib,
      });

      const connectPromise = client.connect();
      setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
      await connectPromise;

      client.subscribeDevice('dev-123');

      // Start getDeviceState (won't resolve until we simulate response)
      const statePromise = client.getDeviceState('dev-123');

      // Check that empty message was published to shadow/get
      const published = mockMqttLib.getLastClient().published;
      expect(published.some(p => p.topic === '$aws/things/dev-123/shadow/get')).toBe(true);

      // Simulate accepted response
      mockMqttLib.getLastClient().simulateMessage('$aws/things/dev-123/shadow/get/accepted', {
        state: { reported: { powerOn: true } },
      });

      const state = await statePromise;
      expect(state.state.reported.powerOn).toBe(true);
    });

    it('publishes desired state to shadow/update', async () => {
      client = createMqttClient({
        getMqttInfo: () =>
          Promise.resolve({
            host: 'wss://mqtt.example.com',
            client_id: 'c',
            device_id: 'dev-123',
          }),
        mqttLib: mockMqttLib,
      });

      const connectPromise = client.connect();
      setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
      await connectPromise;

      client.subscribeDevice('dev-123');

      // Start update
      const updatePromise = client.updateDeviceState('dev-123', { powerOn: false });

      // Check published message
      const published = mockMqttLib.getLastClient().published;
      const updateMsg = published.find(p => p.topic === '$aws/things/dev-123/shadow/update');
      expect(updateMsg).toBeDefined();
      const payload = JSON.parse(updateMsg.payload);
      expect(payload.state.desired.powerOn).toBe(false);

      // Simulate accepted response
      mockMqttLib.getLastClient().simulateMessage('$aws/things/dev-123/shadow/update/accepted', {
        state: { desired: { powerOn: false } },
      });

      await updatePromise;
    });

    it('calls onStateChange for shadow delta messages', async () => {
      const onStateChange = jest.fn();
      client = createMqttClient({
        getMqttInfo: () =>
          Promise.resolve({
            host: 'wss://mqtt.example.com',
            client_id: 'c',
            device_id: 'dev-123',
          }),
        onStateChange,
        mqttLib: mockMqttLib,
      });

      const connectPromise = client.connect();
      setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
      await connectPromise;

      client.subscribeDevice('dev-123');

      // Simulate delta message (state change pushed from device)
      mockMqttLib.getLastClient().simulateMessage('$aws/things/dev-123/shadow/update/delta', {
        state: { powerOn: true },
      });

      expect(onStateChange).toHaveBeenCalledWith('dev-123', { powerOn: true }, 'delta');
    });

    it('rejects request on shadow/get/rejected', async () => {
      client = createMqttClient({
        getMqttInfo: () =>
          Promise.resolve({
            host: 'wss://mqtt.example.com',
            client_id: 'c',
            device_id: 'dev-123',
          }),
        mqttLib: mockMqttLib,
      });

      const connectPromise = client.connect();
      setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
      await connectPromise;

      client.subscribeDevice('dev-123');

      const statePromise = client.getDeviceState('dev-123');

      // Simulate rejected response
      mockMqttLib.getLastClient().simulateMessage('$aws/things/dev-123/shadow/get/rejected', {
        message: 'Thing not found',
      });

      await expect(statePromise).rejects.toThrow('Thing not found');
    });

    it('unsubscribes from device topics', async () => {
      client = createMqttClient({
        getMqttInfo: () =>
          Promise.resolve({
            host: 'wss://mqtt.example.com',
            client_id: 'c',
            device_id: 'dev-123',
          }),
        mqttLib: mockMqttLib,
      });

      const connectPromise = client.connect();
      setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
      await connectPromise;

      client.subscribeDevice('dev-123');
      expect(client.getSubscribedDevices()).toContain('dev-123');

      client.unsubscribeDevice('dev-123');
      expect(client.getSubscribedDevices()).not.toContain('dev-123');
    });

    it('disconnects cleanly', async () => {
      client = createMqttClient({
        getMqttInfo: () =>
          Promise.resolve({
            host: 'wss://mqtt.example.com',
            client_id: 'c',
            device_id: 'dev-123',
          }),
        mqttLib: mockMqttLib,
      });

      const connectPromise = client.connect();
      setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
      await connectPromise;

      client.subscribeDevice('dev-123');
      client.disconnect();

      expect(client.isConnected()).toBe(false);
      expect(client.getSubscribedDevices()).toHaveLength(0);
      expect(mockMqttLib.getLastClient().ended).toBe(true);
    });

    it('calls onDisconnect when disconnected', async () => {
      const onDisconnect = jest.fn();
      client = createMqttClient({
        getMqttInfo: () => Promise.resolve({ host: 'wss://mqtt.example.com', client_id: 'c' }),
        onDisconnect,
        mqttLib: mockMqttLib,
      });

      const connectPromise = client.connect();
      setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
      await connectPromise;

      client.disconnect();

      expect(onDisconnect).toHaveBeenCalled();
    });

    it('throws if not connected when getting state', async () => {
      client = createMqttClient({
        getMqttInfo: () => Promise.resolve({ host: 'wss://mqtt.example.com', client_id: 'c' }),
        mqttLib: mockMqttLib,
      });

      await expect(client.getDeviceState('dev-123')).rejects.toThrow('Not connected');
    });

    it('times out if no response received', async () => {
      client = createMqttClient({
        getMqttInfo: () =>
          Promise.resolve({
            host: 'wss://mqtt.example.com',
            client_id: 'c',
            device_id: 'dev-123',
          }),
        mqttLib: mockMqttLib,
      });

      const connectPromise = client.connect();
      setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
      await connectPromise;

      client.subscribeDevice('dev-123');

      // Use a very short timeout
      const statePromise = client.getDeviceState('dev-123', 50);

      // Don't simulate any response, let it timeout
      await expect(statePromise).rejects.toThrow('timeout');
    });
  });
});
