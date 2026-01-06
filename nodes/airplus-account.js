/**
 * Philips Air+ Account config node.
 * Handles OAuth authentication, token management, and MQTT connection.
 */

const { generatePkce, buildAuthUrl, parseRedirectUrl, exchangeCode, refreshTokens, isTokenExpired } = require('../lib/oauth');
const { createApiClient } = require('../lib/api');
const { createMqttClient } = require('../lib/mqtt');
const { parseMessage, mergeStatus } = require('../lib/parser');
const { TOKEN_REFRESH_BUFFER_MS } = require('../lib/constants');

module.exports = function (RED) {
    // PKCE state storage (in-memory, short TTL)
    const pkceStore = new Map();
    const PKCE_TTL_MS = 10 * 60 * 1000; // 10 minutes

    function cleanupPkceStore() {
        const now = Date.now();
        for (const [key, value] of pkceStore) {
            if (now > value.expires) {
                pkceStore.delete(key);
            }
        }
    }

    // Cleanup old PKCE entries periodically
    setInterval(cleanupPkceStore, 60000);

    function AirplusAccountNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Configuration
        node.name = config.name || 'Philips Air+';

        // State
        let mqttClient = null;
        let apiClient = null;
        let deviceCache = [];
        let deviceStatus = new Map(); // deviceId -> status
        let statusCallbacks = new Map(); // deviceId -> Set of callbacks

        // Credentials
        function getAccessToken() {
            return node.credentials.accessToken || null;
        }

        function getRefreshToken() {
            return node.credentials.refreshToken || null;
        }

        function getExpiresAt() {
            return node.credentials.expiresAt ? parseInt(node.credentials.expiresAt, 10) : 0;
        }

        function isAuthenticated() {
            return !!getAccessToken() && !!getRefreshToken();
        }

        // Token management
        async function ensureValidToken() {
            if (!isAuthenticated()) {
                throw new Error('Not authenticated');
            }

            const expiresAt = getExpiresAt();
            if (isTokenExpired(expiresAt, TOKEN_REFRESH_BUFFER_MS)) {
                node.log('Token expired or expiring soon, refreshing...');
                try {
                    const tokens = await refreshTokens(getRefreshToken());
                    updateCredentials(tokens);
                    node.log('Token refreshed successfully');
                } catch (err) {
                    node.error(`Token refresh failed: ${err.message}`);
                    throw err;
                }
            }

            return getAccessToken();
        }

        function updateCredentials(tokens) {
            node.credentials.accessToken = tokens.accessToken;
            node.credentials.refreshToken = tokens.refreshToken;
            node.credentials.expiresAt = String(tokens.expiresAt);

            // Update API client with new token
            if (apiClient) {
                apiClient = createApiClient({
                    getToken: ensureValidToken,
                });
            }
        }

        // API client
        function getApiClient() {
            if (!apiClient) {
                apiClient = createApiClient({
                    getToken: ensureValidToken,
                });
            }
            return apiClient;
        }

        // Device management
        async function fetchDevices() {
            try {
                const client = getApiClient();
                deviceCache = await client.listDevices();
                node.log(`Found ${deviceCache.length} device(s)`);
                return deviceCache;
            } catch (err) {
                node.error(`Failed to fetch devices: ${err.message}`);
                throw err;
            }
        }

        // MQTT connection
        async function connectMqtt() {
            if (mqttClient) {
                mqttClient.disconnect();
            }

            try {
                const client = getApiClient();
                const { signature } = await client.getSignature();

                mqttClient = createMqttClient({
                    clientId: `nodered-${node.id.slice(0, 8)}`,
                    getCredentials: async () => ({
                        token: await ensureValidToken(),
                        signature,
                    }),
                    onMessage: handleMqttMessage,
                    onConnect: () => {
                        node.log('MQTT connected');
                        updateStatus();
                    },
                    onDisconnect: () => {
                        node.warn('MQTT disconnected');
                        updateStatus();
                    },
                    onError: (err) => {
                        node.error(`MQTT error: ${err.message}`);
                    },
                });

                await mqttClient.connect();
                node.log('MQTT connection established');
            } catch (err) {
                node.error(`MQTT connection failed: ${err.message}`);
                throw err;
            }
        }

        function handleMqttMessage(deviceId, rawData) {
            const parsed = parseMessage(rawData);
            if (!parsed) return;

            if (parsed.type === 'status' || parsed.type === 'filter' || parsed.type === 'config') {
                // Merge into device status
                const existing = deviceStatus.get(deviceId) || {};
                const updated = mergeStatus(existing, parsed.data);
                deviceStatus.set(deviceId, updated);

                // Notify subscribers
                const callbacks = statusCallbacks.get(deviceId);
                if (callbacks) {
                    for (const callback of callbacks) {
                        callback(updated, parsed.type);
                    }
                }
            }
        }

        function updateStatus() {
            if (!isAuthenticated()) {
                node.status({ fill: 'grey', shape: 'ring', text: 'not authenticated' });
            } else if (mqttClient && mqttClient.isConnected()) {
                const count = mqttClient.getSubscriptionCount();
                node.status({ fill: 'green', shape: 'dot', text: `connected (${count} devices)` });
            } else {
                node.status({ fill: 'yellow', shape: 'ring', text: 'disconnected' });
            }
        }

        // Public API for status nodes
        node.subscribe = function (deviceId, callback) {
            // Add callback
            if (!statusCallbacks.has(deviceId)) {
                statusCallbacks.set(deviceId, new Set());
            }
            statusCallbacks.get(deviceId).add(callback);

            // Subscribe to MQTT if connected
            if (mqttClient && mqttClient.isConnected()) {
                mqttClient.subscribe(deviceId, () => {});
            }

            updateStatus();

            // Return current status if available
            return deviceStatus.get(deviceId) || null;
        };

        node.unsubscribe = function (deviceId, callback) {
            const callbacks = statusCallbacks.get(deviceId);
            if (callbacks) {
                callbacks.delete(callback);
                if (callbacks.size === 0) {
                    statusCallbacks.delete(deviceId);
                    if (mqttClient) {
                        mqttClient.unsubscribe(deviceId);
                    }
                }
            }
            updateStatus();
        };

        node.getDevices = function () {
            return deviceCache;
        };

        node.getDeviceStatus = function (deviceId) {
            return deviceStatus.get(deviceId) || null;
        };

        node.isConnected = function () {
            return mqttClient && mqttClient.isConnected();
        };

        // Initialize on startup
        async function initialize() {
            if (!isAuthenticated()) {
                updateStatus();
                return;
            }

            try {
                await fetchDevices();
                await connectMqtt();
                updateStatus();
            } catch (err) {
                node.error(`Initialization failed: ${err.message}`);
                updateStatus();
            }
        }

        // Cleanup on close
        node.on('close', function (done) {
            if (mqttClient) {
                mqttClient.disconnect();
                mqttClient = null;
            }
            deviceCache = [];
            deviceStatus.clear();
            statusCallbacks.clear();
            done();
        });

        // Start initialization
        initialize();
    }

    RED.nodes.registerType('airplus-account', AirplusAccountNode, {
        credentials: {
            accessToken: { type: 'password' },
            refreshToken: { type: 'password' },
            expiresAt: { type: 'text' },
        },
    });

    // Admin endpoints for OAuth flow
    RED.httpAdmin.post('/philips-airplus/auth/start', function (req, res) {
        const nodeId = req.body.node;
        if (!nodeId) {
            return res.status(400).json({ error: 'Missing node ID' });
        }

        const { verifier, challenge } = generatePkce();
        const state = nodeId;
        const url = buildAuthUrl(challenge, state);

        // Store PKCE verifier
        pkceStore.set(state, {
            verifier,
            expires: Date.now() + PKCE_TTL_MS,
        });

        res.json({ url, state });
    });

    RED.httpAdmin.post('/philips-airplus/auth/complete', async function (req, res) {
        const { node: nodeId, redirect_url } = req.body;

        if (!nodeId || !redirect_url) {
            return res.status(400).json({ error: 'Missing node ID or redirect URL' });
        }

        const stored = pkceStore.get(nodeId);
        if (!stored) {
            return res.status(400).json({ error: 'Auth session expired or not found' });
        }

        try {
            const { code } = parseRedirectUrl(redirect_url);
            const tokens = await exchangeCode(code, stored.verifier);

            // Clean up PKCE storage
            pkceStore.delete(nodeId);

            // Update node credentials
            const node = RED.nodes.getNode(nodeId);
            if (node) {
                node.credentials.accessToken = tokens.accessToken;
                node.credentials.refreshToken = tokens.refreshToken;
                node.credentials.expiresAt = String(tokens.expiresAt);
            }

            res.json({
                success: true,
                expiresAt: tokens.expiresAt,
            });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    RED.httpAdmin.get('/philips-airplus/devices', async function (req, res) {
        const nodeId = req.query.account;
        if (!nodeId) {
            return res.json([]);
        }

        const node = RED.nodes.getNode(nodeId);
        if (!node || !node.getDevices) {
            return res.json([]);
        }

        const devices = node.getDevices();
        res.json(devices.map((d) => ({ id: d.id, name: d.name, model: d.model })));
    });
};
