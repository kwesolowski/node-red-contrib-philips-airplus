/**
 * Philips Air+ Account config node.
 * Handles OAuth authentication, token management, and MQTT connection.
 */

const {
    generatePkce,
    generateState,
    buildAuthUrl,
    parseRedirectUrl,
    exchangeCode,
    refreshTokens,
    extractUserId,
    isTokenExpired,
} = require('../lib/oauth');
const { createApiClient } = require('../lib/api');
const { createMqttClient } = require('../lib/mqtt');
const { parseShadow, mergeStatus } = require('../lib/parser');
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
        let tokenSet = null; // openid-client TokenSet
        let deviceCache = [];
        let deviceStatus = new Map(); // deviceId -> status
        let statusCallbacks = new Map(); // deviceId -> Set of callbacks

        // Get API client singleton
        function getApiClient() {
            if (!apiClient) {
                apiClient = createApiClient();
            }
            return apiClient;
        }

        // Credentials
        function getUserId() {
            return node.credentials.userId || null;
        }

        function getRefreshToken() {
            return node.credentials.refreshToken || null;
        }

        function getExpiresAt() {
            return node.credentials.expiresAt ? parseInt(node.credentials.expiresAt, 10) : 0;
        }

        function isAuthenticated() {
            return !!getUserId() && !!getRefreshToken();
        }

        // Token management
        async function ensureValidToken() {
            if (!isAuthenticated()) {
                throw new Error('Not authenticated');
            }

            const expiresAt = getExpiresAt();
            if (expiresAt && Date.now() >= expiresAt * 1000 - TOKEN_REFRESH_BUFFER_MS) {
                node.log('Token expired or expiring soon, refreshing...');
                try {
                    tokenSet = await refreshTokens(getRefreshToken());
                    updateCredentials(tokenSet);
                    node.log('Token refreshed successfully');
                } catch (err) {
                    node.error(`Token refresh failed: ${err.message}`);
                    throw err;
                }
            }

            return getUserId();
        }

        function updateCredentials(newTokenSet) {
            const userId = extractUserId(newTokenSet);
            node.credentials.userId = userId;
            node.credentials.refreshToken = newTokenSet.refresh_token;
            node.credentials.expiresAt = String(newTokenSet.expires_at || 0);
            tokenSet = newTokenSet;

            // Clear API token cache on credential update
            getApiClient().clearToken();
        }

        // Device management
        async function fetchDevices() {
            try {
                const userId = await ensureValidToken();
                const client = getApiClient();
                deviceCache = await client.listDevices(userId);
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
                mqttClient = createMqttClient({
                    getMqttInfo: async () => {
                        const userId = await ensureValidToken();
                        const client = getApiClient();
                        const deviceIds = deviceCache.map((d) => d.id);
                        if (deviceIds.length === 0) {
                            throw new Error('No devices to connect');
                        }
                        const mqttInfos = await client.getMqttInfo(userId, deviceIds);
                        if (!mqttInfos || mqttInfos.length === 0) {
                            throw new Error('No MQTT info returned');
                        }
                        // Return first device's MQTT info (all devices share same broker)
                        return mqttInfos[0];
                    },
                    onStateChange: handleStateChange,
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

                // Subscribe to all devices
                for (const device of deviceCache) {
                    mqttClient.subscribeDevice(device.id);
                }

                node.log('MQTT connection established');
            } catch (err) {
                node.error(`MQTT connection failed: ${err.message}`);
                throw err;
            }
        }

        function handleStateChange(deviceId, state, type) {
            // Parse state based on type
            let parsed;
            if (type === 'reported') {
                parsed = parseShadow({ state: { reported: state } });
            } else if (type === 'delta') {
                // Delta contains just the changed properties
                parsed = { reported: state, delta: true };
            } else {
                parsed = parseShadow(state);
            }

            if (!parsed) return;

            // Merge into device status
            const existing = deviceStatus.get(deviceId) || {};
            const updated = mergeStatus(existing, parsed.reported || parsed);
            deviceStatus.set(deviceId, updated);

            // Notify subscribers
            const callbacks = statusCallbacks.get(deviceId);
            if (callbacks) {
                for (const callback of callbacks) {
                    callback(updated, type);
                }
            }
        }

        function updateStatus() {
            if (!isAuthenticated()) {
                node.status({ fill: 'grey', shape: 'ring', text: 'not authenticated' });
            } else if (mqttClient && mqttClient.isConnected()) {
                const count = mqttClient.getSubscribedDevices().length;
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
                mqttClient.subscribeDevice(deviceId);
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
                        mqttClient.unsubscribeDevice(deviceId);
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

        node.getDeviceState = async function (deviceId) {
            if (!mqttClient || !mqttClient.isConnected()) {
                throw new Error('Not connected');
            }
            return mqttClient.getDeviceState(deviceId);
        };

        node.updateDeviceState = async function (deviceId, desiredState) {
            if (!mqttClient || !mqttClient.isConnected()) {
                throw new Error('Not connected');
            }
            return mqttClient.updateDeviceState(deviceId, desiredState);
        };

        // Initialize on startup
        async function initialize() {
            if (!isAuthenticated()) {
                updateStatus();
                return;
            }

            try {
                await fetchDevices();
                if (deviceCache.length > 0) {
                    await connectMqtt();
                }
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
            userId: { type: 'text' },
            refreshToken: { type: 'password' },
            expiresAt: { type: 'text' },
        },
    });

    // Admin endpoints for OAuth flow
    RED.httpAdmin.post('/philips-airplus/auth/start', async function (req, res) {
        const nodeId = req.body.node;
        if (!nodeId) {
            return res.status(400).json({ error: 'Missing node ID' });
        }

        try {
            const { verifier, challenge } = generatePkce();
            const state = generateState();
            const url = await buildAuthUrl({ codeChallenge: challenge, state });

            // Store PKCE verifier with state as key
            pkceStore.set(state, {
                verifier,
                nodeId,
                expires: Date.now() + PKCE_TTL_MS,
            });

            res.json({ url, state });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    RED.httpAdmin.post('/philips-airplus/auth/complete', async function (req, res) {
        const { redirect_url } = req.body;

        if (!redirect_url) {
            return res.status(400).json({ error: 'Missing redirect URL' });
        }

        try {
            const { code, state } = parseRedirectUrl(redirect_url);

            const stored = pkceStore.get(state);
            if (!stored) {
                return res.status(400).json({ error: 'Auth session expired or not found' });
            }

            const tokenSet = await exchangeCode({
                code,
                codeVerifier: stored.verifier,
            });

            // Clean up PKCE storage
            pkceStore.delete(state);

            // Extract user ID
            const userId = extractUserId(tokenSet);

            // Update node credentials
            const node = RED.nodes.getNode(stored.nodeId);
            if (node) {
                node.credentials.userId = userId;
                node.credentials.refreshToken = tokenSet.refresh_token;
                node.credentials.expiresAt = String(tokenSet.expires_at || 0);
            }

            res.json({
                success: true,
                userId,
                expiresAt: tokenSet.expires_at,
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
