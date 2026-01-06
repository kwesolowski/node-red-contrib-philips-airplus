/**
 * WebSocket MQTT client for Philips Air+ cloud.
 * Uses AWS IoT custom authorizer for authentication.
 */

const mqtt = require('mqtt');
const {
    MQTT_HOST,
    MQTT_PORT,
    MQTT_PATH,
    MQTT_KEEPALIVE_SEC,
    MQTT_CUSTOM_AUTHORIZER,
    TOPIC_STATUS,
    RECONNECT_BASE_MS,
    RECONNECT_MAX_MS,
} = require('./constants');

/**
 * Create an MQTT client for Philips Air+ devices.
 * @param {object} options
 * @param {string} options.clientId - MQTT client ID
 * @param {function} options.getCredentials - Async function returning { token, signature }
 * @param {function} [options.onMessage] - Callback for incoming messages (deviceId, data)
 * @param {function} [options.onConnect] - Callback when connected
 * @param {function} [options.onDisconnect] - Callback when disconnected
 * @param {function} [options.onError] - Callback for errors
 * @param {object} [options.mqttLib] - Optional mqtt library (for testing)
 * @returns {object} MQTT client wrapper
 */
function createMqttClient({
    clientId,
    getCredentials,
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    mqttLib = mqtt,
}) {
    let client = null;
    let connected = false;
    let reconnectAttempts = 0;
    let reconnectTimer = null;
    const subscriptions = new Map(); // deviceId -> callback

    function buildUrl() {
        return `wss://${MQTT_HOST}:${MQTT_PORT}${MQTT_PATH}`;
    }

    async function buildOptions() {
        const { token, signature } = await getCredentials();

        return {
            clientId,
            protocolVersion: 4, // MQTT 3.1.1
            keepalive: MQTT_KEEPALIVE_SEC,
            clean: true,
            reconnectPeriod: 0, // We handle reconnection manually
            wsOptions: {
                headers: {
                    'x-amz-customauthorizer-name': MQTT_CUSTOM_AUTHORIZER,
                    'x-amz-customauthorizer-signature': signature,
                    tenant: 'da',
                    'content-type': 'application/json',
                    'token-header': `Bearer ${token.trim()}`,
                },
            },
        };
    }

    function getStatusTopic(deviceId) {
        return TOPIC_STATUS.replace('{deviceId}', deviceId);
    }

    function parseDeviceIdFromTopic(topic) {
        // Topic format: da_ctrl/{deviceId}/from_ncp
        const match = topic.match(/^da_ctrl\/([^/]+)\/from_ncp$/);
        return match ? match[1] : null;
    }

    function handleMessage(topic, payload) {
        const deviceId = parseDeviceIdFromTopic(topic);
        if (!deviceId) return;

        let data;
        try {
            data = JSON.parse(payload.toString());
        } catch {
            data = { raw: payload.toString() };
        }

        // Call device-specific callback if registered
        const callback = subscriptions.get(deviceId);
        if (callback) {
            callback(data);
        }

        // Call global message handler
        if (onMessage) {
            onMessage(deviceId, data);
        }
    }

    function handleConnect() {
        connected = true;
        reconnectAttempts = 0;

        // Resubscribe to all devices
        for (const deviceId of subscriptions.keys()) {
            const topic = getStatusTopic(deviceId);
            client.subscribe(topic, { qos: 0 });
        }

        if (onConnect) {
            onConnect();
        }
    }

    function handleDisconnect() {
        connected = false;
        if (onDisconnect) {
            onDisconnect();
        }
    }

    function handleError(err) {
        if (onError) {
            onError(err);
        }
    }

    function scheduleReconnect() {
        if (reconnectTimer) return;

        reconnectAttempts++;
        const delay = Math.min(
            RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts - 1),
            RECONNECT_MAX_MS
        );

        reconnectTimer = setTimeout(async () => {
            reconnectTimer = null;
            try {
                await connect();
            } catch (err) {
                handleError(err);
                scheduleReconnect();
            }
        }, delay);
    }

    async function connect() {
        if (client) {
            client.end(true);
            client = null;
        }

        const url = buildUrl();
        const options = await buildOptions();

        return new Promise((resolve, reject) => {
            client = mqttLib.connect(url, options);

            client.on('connect', () => {
                handleConnect();
                resolve();
            });

            client.on('message', handleMessage);

            client.on('close', () => {
                handleDisconnect();
                if (subscriptions.size > 0) {
                    scheduleReconnect();
                }
            });

            client.on('error', (err) => {
                handleError(err);
                reject(err);
            });

            // Timeout for initial connection
            setTimeout(() => {
                if (!connected) {
                    reject(new Error('Connection timeout'));
                }
            }, 15000);
        });
    }

    function disconnect() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        subscriptions.clear();
        if (client) {
            client.end(true);
            client = null;
        }
        connected = false;
    }

    function subscribe(deviceId, callback) {
        subscriptions.set(deviceId, callback);

        if (connected && client) {
            const topic = getStatusTopic(deviceId);
            client.subscribe(topic, { qos: 0 });
        }
    }

    function unsubscribe(deviceId) {
        subscriptions.delete(deviceId);

        if (connected && client) {
            const topic = getStatusTopic(deviceId);
            client.unsubscribe(topic);
        }
    }

    return {
        connect,
        disconnect,
        subscribe,
        unsubscribe,
        isConnected: () => connected,
        getSubscriptionCount: () => subscriptions.size,
    };
}

module.exports = {
    createMqttClient,
};
