/**
 * Philips Air+ Account config node.
 * Handles OAuth authentication, token management, and MQTT connection.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const {
  generatePkce,
  generateState,
  buildAuthUrl,
  parseRedirectUrl,
  exchangeCode,
  refreshTokens,
  extractUserId,
} = require('../lib/oauth');
const { createApiClient } = require('../lib/api');
const { createMqttClient } = require('../lib/mqtt');
const { parseShadow, mergeStatus } = require('../lib/parser');
const { TOKEN_REFRESH_BUFFER_MS } = require('../lib/constants');

// CLI credentials file location
const CREDENTIALS_FILE = path.join(os.homedir(), '.philips-airplus', 'credentials.json');

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
    const mqttClients = new Map(); // deviceId -> mqttClient
    let apiClient = null;
    let tokenSet = null; // openid-client TokenSet
    let deviceCache = [];
    let deviceStatus = new Map(); // deviceId -> status
    let statusCallbacks = new Map(); // deviceId -> Set of callbacks

    // Get API client singleton
    function getApiClient() {
      if (!apiClient) {
        apiClient = createApiClient({
          log: msg => node.log(msg),
        });
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
      const credentials = {
        userId: userId,
        refreshToken: newTokenSet.refresh_token,
        expiresAt: String(newTokenSet.expires_at || 0),
      };

      // Write to CLI file FIRST (single source of truth)
      try {
        const dir = path.dirname(CREDENTIALS_FILE);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(
          CREDENTIALS_FILE,
          JSON.stringify(
            {
              user_id: userId,
              refresh_token: newTokenSet.refresh_token,
              expires_at: newTokenSet.expires_at || 0,
              saved_at: new Date().toISOString(),
            },
            null,
            2
          )
        );
        node.log('Credentials written to CLI file');
      } catch (err) {
        node.error(`Failed to write credentials to CLI file: ${err.message}`);
      }

      // Update in-memory credentials
      node.credentials = credentials;
      tokenSet = newTokenSet;

      // Also persist to Node-RED (backup, but CLI file is authoritative)
      RED.nodes.addCredentials(node.id, credentials);

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

    // MQTT connection - creates one client per device
    async function connectMqtt() {
      // Disconnect existing clients
      for (const [deviceId, client] of mqttClients) {
        node.log(`Disconnecting existing client for ${deviceId}`);
        client.disconnect();
      }
      mqttClients.clear();

      if (deviceCache.length === 0) {
        node.warn('No devices to connect');
        return;
      }

      // Get MQTT credentials for all devices
      const userId = await ensureValidToken();
      const client = getApiClient();
      const deviceIds = deviceCache.map(d => d.id);
      node.log(`Getting MQTT info for ${deviceIds.length} device(s)`);
      const mqttInfos = await client.getMqttInfo(userId, deviceIds);

      if (!mqttInfos || mqttInfos.length === 0) {
        throw new Error('No MQTT info returned');
      }

      // Create MQTT client for each device
      for (const mqttInfo of mqttInfos) {
        const deviceId = mqttInfo.device_id;
        const device = deviceCache.find(d => d.id === deviceId);
        const deviceName = device?.name || deviceId;

        node.log(`Creating MQTT client for ${deviceName} (${deviceId})`);

        const mqttClient = createMqttClient({
          getMqttInfo: async () => mqttInfo,
          onStateChange: handleStateChange,
          onConnect: () => {
            node.log(`MQTT connected: ${deviceName}`);
            updateStatus();
            // Emit event for this device's connection
            node.emit('connected', deviceId);
          },
          onDisconnect: () => {
            node.warn(`MQTT disconnected: ${deviceName}`);
            updateStatus();
            // Emit event for this device's disconnection
            node.emit('disconnected', deviceId);
          },
          onError: err => {
            node.error(`MQTT error (${deviceName}): ${err.message}`);
          },
          log: msg => node.log(msg),
          verboseLogging: config.verboseLogging || false,
        });

        mqttClients.set(deviceId, mqttClient);

        try {
          await mqttClient.connect();
          mqttClient.subscribeDevice(deviceId);
          node.log(`MQTT connected and subscribed: ${deviceName}`);
        } catch (err) {
          node.error(`MQTT connection failed for ${deviceName}: ${err.message}`);
        }
      }

      node.log(`MQTT connections established for ${mqttClients.size} device(s)`);
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
      } else {
        const connectedCount = Array.from(mqttClients.values()).filter(c => c.isConnected()).length;
        if (connectedCount > 0) {
          node.status({
            fill: 'green',
            shape: 'dot',
            text: `connected (${connectedCount} devices)`,
          });
        } else if (mqttClients.size > 0) {
          node.status({ fill: 'yellow', shape: 'ring', text: 'connecting...' });
        } else {
          node.status({ fill: 'yellow', shape: 'ring', text: 'disconnected' });
        }
      }
    }

    // Public API for status nodes
    node.subscribe = function (deviceId, callback) {
      // Add callback
      if (!statusCallbacks.has(deviceId)) {
        statusCallbacks.set(deviceId, new Set());
      }
      statusCallbacks.get(deviceId).add(callback);

      // Get client for this device
      const mqttClient = mqttClients.get(deviceId);
      if (mqttClient && mqttClient.isConnected()) {
        mqttClient.subscribeDevice(deviceId);

        // Request initial state
        // Delay to allow subscriptions to complete (SUBACK is async)
        if (!deviceStatus.has(deviceId)) {
          setTimeout(() => {
            const client = mqttClients.get(deviceId);
            if (client && client.isConnected() && !deviceStatus.has(deviceId)) {
              node.log(`Requesting initial state for ${deviceId}`);
              client.getDeviceState(deviceId).catch(err => {
                node.warn(`Failed to get initial state: ${err.message}`);
              });
            }
          }, 1000);
        }
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
          const mqttClient = mqttClients.get(deviceId);
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

    node.isConnected = function (deviceId) {
      if (deviceId) {
        const client = mqttClients.get(deviceId);
        return client && client.isConnected();
      }
      // Any device connected
      return Array.from(mqttClients.values()).some(c => c.isConnected());
    };

    node.getDeviceState = async function (deviceId) {
      const mqttClient = mqttClients.get(deviceId);
      if (!mqttClient || !mqttClient.isConnected()) {
        throw new Error(`Not connected to device ${deviceId}`);
      }
      return mqttClient.getDeviceState(deviceId);
    };

    node.updateDeviceState = async function (deviceId, desiredState) {
      const mqttClient = mqttClients.get(deviceId);
      if (!mqttClient || !mqttClient.isConnected()) {
        throw new Error(`Not connected to device ${deviceId}`);
      }
      return mqttClient.updateDeviceState(deviceId, desiredState);
    };

    // Load credentials from CLI file (single source of truth)
    function loadCredentialsFromCliFile() {
      try {
        if (fs.existsSync(CREDENTIALS_FILE)) {
          const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
          if (data.user_id && data.refresh_token) {
            node.credentials = {
              userId: data.user_id,
              refreshToken: data.refresh_token,
              expiresAt: String(data.expires_at || 0),
            };
            node.log(`Loaded credentials from CLI file (user: ${data.user_id})`);
            return true;
          }
        }
      } catch (err) {
        node.warn(`Failed to load CLI credentials: ${err.message}`);
      }
      return false;
    }

    // Initialize on startup
    async function initialize() {
      // Always load from CLI file first (single source of truth)
      loadCredentialsFromCliFile();

      node.log(`Initializing... userId=${getUserId()}, hasRefreshToken=${!!getRefreshToken()}`);

      if (!isAuthenticated()) {
        node.log('Not authenticated, skipping initialization');
        updateStatus();
        return;
      }

      try {
        node.log('Fetching devices...');
        await fetchDevices();
        node.log(`Fetched ${deviceCache.length} device(s)`);

        if (deviceCache.length > 0) {
          node.log('Connecting to MQTT...');
          await connectMqtt();
        } else {
          node.warn('No devices found, skipping MQTT connection');
        }
        updateStatus();
      } catch (err) {
        node.error(`Initialization failed: ${err.message}`);
        node.error(err.stack);
        updateStatus();
      }
    }

    // Cleanup on close
    node.on('close', function (done) {
      for (const [deviceId, client] of mqttClients) {
        node.log(`Disconnecting client for ${deviceId}`);
        client.disconnect();
      }
      mqttClients.clear();
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
    res.json(devices.map(d => ({ id: d.id, name: d.name, model: d.model })));
  });

  // Export credentials as JSON (for transfer to another instance)
  RED.httpAdmin.get('/philips-airplus/export-credentials', function (req, res) {
    try {
      if (fs.existsSync(CREDENTIALS_FILE)) {
        const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
        res.json({ credentials: data });
      } else {
        res.json({ credentials: null });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Clear credentials (for transfer - after exporting)
  RED.httpAdmin.post('/philips-airplus/clear-credentials', function (req, res) {
    const nodeId = req.body.node;
    RED.log.info(`[airplus] Clearing credentials for node ${nodeId}`);

    try {
      // Delete CLI file
      if (fs.existsSync(CREDENTIALS_FILE)) {
        fs.unlinkSync(CREDENTIALS_FILE);
        RED.log.info(`[airplus] Deleted ${CREDENTIALS_FILE}`);
      }

      // Clear Node-RED credentials
      if (nodeId) {
        RED.nodes.addCredentials(nodeId, {});
        const node = RED.nodes.getNode(nodeId);
        if (node) {
          node.credentials = {};
        }
      }

      res.json({ success: true });
    } catch (err) {
      RED.log.error(`[airplus] Clear failed: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Check if CLI credentials file exists
  RED.httpAdmin.get('/philips-airplus/cli-credentials', function (req, res) {
    RED.log.debug(`[airplus] Checking CLI credentials at ${CREDENTIALS_FILE}`);
    try {
      if (fs.existsSync(CREDENTIALS_FILE)) {
        const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
        RED.log.debug(`[airplus] CLI credentials found for user ${data.user_id}`);
        res.json({
          exists: true,
          userId: data.user_id,
          expiresAt: data.expires_at,
          savedAt: data.saved_at,
        });
      } else {
        RED.log.debug('[airplus] CLI credentials file not found');
        res.json({ exists: false });
      }
    } catch (err) {
      RED.log.error(`[airplus] Error reading CLI credentials: ${err.message}`);
      res.json({ exists: false, error: err.message });
    }
  });

  // Get version info (package.json + git describe if available)
  RED.httpAdmin.get('/philips-airplus/version', function (req, res) {
    try {
      const packageJson = require('../package.json');
      let gitVersion = null;
      try {
        gitVersion = execSync('git describe --always --dirty', {
          cwd: __dirname,
          encoding: 'utf8',
          timeout: 1000,
        }).trim();
      } catch (e) {
        // Ignore git errors (not a git repo or git not installed)
      }
      res.json({
        package: packageJson.version,
        git: gitVersion,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Import credentials from JSON (for cross-machine transfer)
  RED.httpAdmin.post('/philips-airplus/import-credentials', function (req, res) {
    const nodeId = req.body.node;
    const data = req.body.credentials;

    RED.log.info(`[airplus] Importing credentials for node ${nodeId}`);

    if (!nodeId) {
      return res.status(400).json({ error: 'Missing node ID' });
    }

    if (!data || !data.user_id || !data.refresh_token) {
      return res
        .status(400)
        .json({ error: 'Invalid credentials: missing user_id or refresh_token' });
    }

    try {
      // Write to CLI file (single source of truth)
      const dir = path.dirname(CREDENTIALS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      fs.writeFileSync(
        CREDENTIALS_FILE,
        JSON.stringify(
          {
            user_id: data.user_id,
            refresh_token: data.refresh_token,
            access_token: data.access_token || null,
            expires_at: data.expires_at || 0,
            saved_at: new Date().toISOString(),
          },
          null,
          2
        ),
        { mode: 0o600 }
      );
      RED.log.info(`[airplus] Credentials written to ${CREDENTIALS_FILE}`);

      // Update Node-RED credentials
      const credentials = {
        userId: data.user_id,
        refreshToken: data.refresh_token,
        expiresAt: String(data.expires_at || 0),
      };
      RED.nodes.addCredentials(nodeId, credentials);

      // Update runtime node if it exists
      const node = RED.nodes.getNode(nodeId);
      if (node) {
        node.credentials = credentials;
      }

      res.json({
        success: true,
        userId: data.user_id,
        expiresAt: data.expires_at,
      });
    } catch (err) {
      RED.log.error(`[airplus] Import failed: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Load credentials from CLI file into node
  RED.httpAdmin.post('/philips-airplus/load-cli-credentials', function (req, res) {
    const nodeId = req.body.node;
    RED.log.info(`[airplus] Loading CLI credentials for node ${nodeId}`);

    if (!nodeId) {
      RED.log.error('[airplus] Missing node ID in load request');
      return res.status(400).json({ error: 'Missing node ID' });
    }

    try {
      if (!fs.existsSync(CREDENTIALS_FILE)) {
        RED.log.error(`[airplus] Credentials file not found at ${CREDENTIALS_FILE}`);
        return res
          .status(404)
          .json({ error: 'Credentials file not found. Run: npx philips-airplus-auth' });
      }

      const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
      RED.log.debug(
        `[airplus] Read credentials: user_id=${data.user_id}, has_refresh=${!!data.refresh_token}`
      );

      if (!data.user_id || !data.refresh_token) {
        RED.log.error('[airplus] Invalid credentials file: missing user_id or refresh_token');
        return res.status(400).json({ error: 'Invalid credentials file' });
      }

      const credentials = {
        userId: data.user_id,
        refreshToken: data.refresh_token,
        expiresAt: String(data.expires_at || 0),
      };

      // Persist credentials using Node-RED's credential system
      RED.nodes.addCredentials(nodeId, credentials);
      RED.log.info(`[airplus] Credentials saved for node ${nodeId}, user ${data.user_id}`);

      // Also update runtime node if it exists
      const node = RED.nodes.getNode(nodeId);
      if (node) {
        node.credentials = credentials;
        RED.log.debug(`[airplus] Updated runtime credentials for node ${nodeId}`);
      } else {
        RED.log.debug(`[airplus] Node ${nodeId} not instantiated yet (config node during edit)`);
      }

      res.json({
        success: true,
        userId: data.user_id,
        expiresAt: data.expires_at,
      });
    } catch (err) {
      RED.log.error(`[airplus] Error loading credentials: ${err.message}`);
      RED.log.error(err.stack);
      res.status(500).json({ error: err.message });
    }
  });
};
