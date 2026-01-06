const { createMqttClient } = require('../lib/mqtt');
const EventEmitter = require('events');

// Mock MQTT client
class MockMqttClient extends EventEmitter {
    constructor() {
        super();
        this.subscriptions = [];
        this.ended = false;
    }

    subscribe(topic, opts) {
        this.subscriptions.push(topic);
    }

    unsubscribe(topic) {
        this.subscriptions = this.subscriptions.filter((t) => t !== topic);
    }

    end(force) {
        this.ended = true;
        this.emit('close');
    }

    // Helper to simulate connection
    simulateConnect() {
        this.emit('connect');
    }

    // Helper to simulate message
    simulateMessage(topic, payload) {
        this.emit('message', topic, Buffer.from(JSON.stringify(payload)));
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

        it('connects with correct URL', async () => {
            client = createMqttClient({
                clientId: 'test-client',
                getCredentials: () =>
                    Promise.resolve({ token: 'tok', signature: 'sig' }),
                mqttLib: mockMqttLib,
            });

            const connectPromise = client.connect();
            // Simulate successful connection
            setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
            await connectPromise;

            expect(mockMqttLib.connect).toHaveBeenCalledWith(
                expect.stringContaining('wss://'),
                expect.any(Object)
            );
        });

        it('includes auth headers in WebSocket options', async () => {
            client = createMqttClient({
                clientId: 'test-client',
                getCredentials: () =>
                    Promise.resolve({ token: 'my-token', signature: 'my-sig' }),
                mqttLib: mockMqttLib,
            });

            const connectPromise = client.connect();
            setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
            await connectPromise;

            const opts = mockMqttLib.getLastClient().opts;
            expect(opts.wsOptions.headers['token-header']).toBe('Bearer my-token');
            expect(opts.wsOptions.headers['x-amz-customauthorizer-signature']).toBe(
                'my-sig'
            );
        });

        it('calls onConnect when connected', async () => {
            const onConnect = jest.fn();
            client = createMqttClient({
                clientId: 'test-client',
                getCredentials: () =>
                    Promise.resolve({ token: 'tok', signature: 'sig' }),
                onConnect,
                mqttLib: mockMqttLib,
            });

            const connectPromise = client.connect();
            setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
            await connectPromise;

            expect(onConnect).toHaveBeenCalled();
            expect(client.isConnected()).toBe(true);
        });

        it('subscribes to device topic', async () => {
            const deviceCallback = jest.fn();
            client = createMqttClient({
                clientId: 'test-client',
                getCredentials: () =>
                    Promise.resolve({ token: 'tok', signature: 'sig' }),
                mqttLib: mockMqttLib,
            });

            const connectPromise = client.connect();
            setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
            await connectPromise;

            client.subscribe('da-device-123', deviceCallback);

            expect(mockMqttLib.getLastClient().subscriptions).toContain(
                'da_ctrl/da-device-123/from_ncp'
            );
        });

        it('routes messages to device callback', async () => {
            const deviceCallback = jest.fn();
            client = createMqttClient({
                clientId: 'test-client',
                getCredentials: () =>
                    Promise.resolve({ token: 'tok', signature: 'sig' }),
                mqttLib: mockMqttLib,
            });

            const connectPromise = client.connect();
            setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
            await connectPromise;

            client.subscribe('da-device-123', deviceCallback);

            // Simulate incoming message
            mockMqttLib
                .getLastClient()
                .simulateMessage('da_ctrl/da-device-123/from_ncp', {
                    power: true,
                    mode: 'A',
                });

            expect(deviceCallback).toHaveBeenCalledWith({
                power: true,
                mode: 'A',
            });
        });

        it('calls global onMessage handler', async () => {
            const onMessage = jest.fn();
            client = createMqttClient({
                clientId: 'test-client',
                getCredentials: () =>
                    Promise.resolve({ token: 'tok', signature: 'sig' }),
                onMessage,
                mqttLib: mockMqttLib,
            });

            const connectPromise = client.connect();
            setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
            await connectPromise;

            client.subscribe('da-device-123', () => {});

            mockMqttLib
                .getLastClient()
                .simulateMessage('da_ctrl/da-device-123/from_ncp', { pm25: 15 });

            expect(onMessage).toHaveBeenCalledWith('da-device-123', { pm25: 15 });
        });

        it('unsubscribes from device topic', async () => {
            client = createMqttClient({
                clientId: 'test-client',
                getCredentials: () =>
                    Promise.resolve({ token: 'tok', signature: 'sig' }),
                mqttLib: mockMqttLib,
            });

            const connectPromise = client.connect();
            setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
            await connectPromise;

            client.subscribe('da-device-123', () => {});
            expect(client.getSubscriptionCount()).toBe(1);

            client.unsubscribe('da-device-123');
            expect(client.getSubscriptionCount()).toBe(0);
        });

        it('disconnects cleanly', async () => {
            client = createMqttClient({
                clientId: 'test-client',
                getCredentials: () =>
                    Promise.resolve({ token: 'tok', signature: 'sig' }),
                mqttLib: mockMqttLib,
            });

            const connectPromise = client.connect();
            setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
            await connectPromise;

            client.subscribe('da-device-123', () => {});
            client.disconnect();

            expect(client.isConnected()).toBe(false);
            expect(client.getSubscriptionCount()).toBe(0);
            expect(mockMqttLib.getLastClient().ended).toBe(true);
        });

        it('calls onDisconnect when disconnected', async () => {
            const onDisconnect = jest.fn();
            client = createMqttClient({
                clientId: 'test-client',
                getCredentials: () =>
                    Promise.resolve({ token: 'tok', signature: 'sig' }),
                onDisconnect,
                mqttLib: mockMqttLib,
            });

            const connectPromise = client.connect();
            setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
            await connectPromise;

            client.disconnect();

            expect(onDisconnect).toHaveBeenCalled();
        });

        it('resubscribes after reconnect', async () => {
            client = createMqttClient({
                clientId: 'test-client',
                getCredentials: () =>
                    Promise.resolve({ token: 'tok', signature: 'sig' }),
                mqttLib: mockMqttLib,
            });

            const connectPromise = client.connect();
            setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
            await connectPromise;

            // Subscribe to a device
            client.subscribe('da-device-123', () => {});
            const firstClient = mockMqttLib.getLastClient();

            // Reconnect
            const reconnectPromise = client.connect();
            setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
            await reconnectPromise;

            const secondClient = mockMqttLib.getLastClient();
            expect(secondClient).not.toBe(firstClient);
            expect(secondClient.subscriptions).toContain(
                'da_ctrl/da-device-123/from_ncp'
            );
        });

        it('ignores messages from unknown topics', async () => {
            const onMessage = jest.fn();
            client = createMqttClient({
                clientId: 'test-client',
                getCredentials: () =>
                    Promise.resolve({ token: 'tok', signature: 'sig' }),
                onMessage,
                mqttLib: mockMqttLib,
            });

            const connectPromise = client.connect();
            setTimeout(() => mockMqttLib.getLastClient().simulateConnect(), 10);
            await connectPromise;

            // Message from unrecognized topic format
            mockMqttLib
                .getLastClient()
                .emit('message', 'other/topic', Buffer.from('{}'));

            expect(onMessage).not.toHaveBeenCalled();
        });
    });
});
