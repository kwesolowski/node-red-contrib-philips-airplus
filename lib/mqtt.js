/**
 * AWS IoT MQTT client for Philips Air+ devices.
 * Uses presigned WebSocket URLs from MxChip API for authentication.
 * Implements AWS IoT Device Shadow protocol for device control.
 */

const mqtt = require('mqtt');
const { circuitBreaker, handleAll, ConsecutiveBreaker, BrokenCircuitError } = require('cockatiel');
const {
  TOPIC_SHADOW_GET,
  TOPIC_SHADOW_GET_ACCEPTED,
  TOPIC_SHADOW_GET_REJECTED,
  TOPIC_SHADOW_UPDATE,
  TOPIC_SHADOW_UPDATE_ACCEPTED,
  TOPIC_SHADOW_UPDATE_REJECTED,
  TOPIC_SHADOW_UPDATE_DELTA,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  MQTT_CREDENTIALS_REFRESH_MS,
} = require('./constants');

/**
 * Replace {deviceId} placeholder in topic template.
 * @param {string} template - Topic template with {deviceId}
 * @param {string} deviceId - Device ID to insert
 * @returns {string} Complete topic
 */
function formatTopic(template, deviceId) {
  return template.replace('{deviceId}', deviceId);
}

/**
 * Create an MQTT client for Philips Air+ devices.
 * @param {object} options
 * @param {function} options.getMqttInfo - Async function returning MqttInfo from API
 * @param {function} [options.onStateChange] - Callback for device state changes (deviceId, state)
 * @param {function} [options.onConnect] - Callback when connected
 * @param {function} [options.onDisconnect] - Callback when disconnected
 * @param {function} [options.onError] - Callback for errors
 * @param {object} [options.mqttLib] - Optional mqtt library (for testing)
 * @returns {object} MQTT client wrapper
 */
function createMqttClient({
  getMqttInfo,
  onStateChange,
  onConnect,
  onDisconnect,
  onError,
  mqttLib = mqtt,
  log = console.log,
  verboseLogging = false,
}) {
  let client = null;
  let connected = false;
  let currentMqttInfo = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let credentialsRefreshTimer = null;
  let authorizedDeviceId = null; // Device ID from MQTT credentials (presigned URL)
  let isIntentionalDisconnect = false; // Flag to suppress auto-reconnect during credential refresh
  const subscribedDevices = new Set(); // Devices requested by status nodes
  const pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }
  let lastConnectedAt = null; // Timestamp of last successful connection
  let lastDisconnectedAt = null; // Timestamp of last disconnect
  let firstFailureAt = null; // Timestamp of first failure in current failure sequence

  // Verbose logging helper
  const vlog = msg => {
    if (verboseLogging) log(msg);
  };

  // Circuit breaker to prevent hammering AWS IoT when persistently unreachable
  const connectionBreaker = circuitBreaker(handleAll, {
    halfOpenAfter: 5 * 60 * 1000, // Try again after 5 minutes when open
    breaker: new ConsecutiveBreaker(10), // Open after 10 consecutive failures
  });

  // Log circuit state changes
  connectionBreaker.onStateChange(state => {
    if (state === 'open') {
      const failureDuration = firstFailureAt ? Math.round((Date.now() - firstFailureAt) / 1000) : 0;
      const lastConnectedAgo = lastConnectedAt
        ? Math.round((Date.now() - lastConnectedAt) / 1000)
        : null;

      let message = '[mqtt] Circuit breaker OPEN - AWS IoT persistently unreachable';
      if (failureDuration > 0) {
        message += `, failing for ${failureDuration}s`;
      }
      if (lastConnectedAgo !== null) {
        message += `, last connected ${lastConnectedAgo}s ago`;
      }
      message += ', backing off for 5min';
      log(message);

      // Clear any pending reconnect timer - circuit breaker will handle retry timing
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (onError) {
        onError(new Error('Circuit breaker open - AWS IoT unreachable after multiple attempts'), {
          recoverable: true,
          circuitBreakerOpen: true,
          nextRetryAt: Date.now() + 5 * 60 * 1000,
          failureDuration,
          lastConnectedAt,
        });
      }
    } else if (state === 'halfOpen') {
      log('[mqtt] Circuit breaker HALF-OPEN - testing connection recovery');
      // Trigger a reconnect attempt if we have subscribed devices
      if (subscribedDevices.size > 0 && !reconnectTimer) {
        scheduleReconnect();
      }
    } else if (state === 'closed') {
      log('[mqtt] Circuit breaker CLOSED - connections successful, normal operation resumed');
    }
  });

  function handleMessage(topic, payload) {
    let data;
    try {
      data = JSON.parse(payload.toString());
    } catch {
      log('[mqtt] Non-JSON payload, ignoring');
      return; // Ignore non-JSON messages
    }

    // Parse device ID from topic
    const match = topic.match(/\$aws\/things\/([^/]+)\/shadow/);
    if (!match) {
      log(`[mqtt] Topic doesn't match shadow pattern: ${topic}`);
      return;
    }
    const deviceId = match[1];
    const msgType = topic.split('/').pop();
    log(`[mqtt] Shadow message for device ${deviceId}, type=${msgType}`);
    vlog(`[mqtt] Shadow payload: ${payload.toString().substring(0, 500)}`);

    // Handle shadow/get/accepted - response to state request
    if (topic.endsWith('/shadow/get/accepted')) {
      const requestId = `get:${deviceId}`;
      const pending = pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingRequests.delete(requestId);
        pending.resolve(data);
      }
      // Also emit state change
      if (onStateChange && data.state?.reported) {
        onStateChange(deviceId, data.state.reported, 'reported');
      }
    }

    // Handle shadow/get/rejected
    else if (topic.endsWith('/shadow/get/rejected')) {
      const requestId = `get:${deviceId}`;
      const pending = pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingRequests.delete(requestId);
        pending.reject(new Error(data.message || 'Shadow get rejected'));
      }
    }

    // Handle shadow/update/accepted
    else if (topic.endsWith('/shadow/update/accepted')) {
      const requestId = `update:${deviceId}`;
      const pending = pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingRequests.delete(requestId);
        pending.resolve(data);
      }
    }

    // Handle shadow/update/rejected
    else if (topic.endsWith('/shadow/update/rejected')) {
      const requestId = `update:${deviceId}`;
      const pending = pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingRequests.delete(requestId);
        pending.reject(new Error(data.message || 'Shadow update rejected'));
      }
    }

    // Handle shadow/update/delta - server pushed state changes
    else if (topic.endsWith('/shadow/update/delta')) {
      if (onStateChange && data.state) {
        onStateChange(deviceId, data.state, 'delta');
      }
    }
  }

  function handleConnect() {
    connected = true;
    reconnectAttempts = 0;
    lastConnectedAt = Date.now();
    firstFailureAt = null; // Clear failure tracking on success

    const disconnectedDuration = lastDisconnectedAt
      ? Math.round((Date.now() - lastDisconnectedAt) / 1000)
      : null;

    log(
      `[mqtt] Connected${disconnectedDuration ? ` after ${disconnectedDuration}s offline` : ''}: ${subscribedDevices.size} devices requested, authorized=${authorizedDeviceId}`
    );

    // Only subscribe to the authorized device (MQTT credentials are per-device)
    if (authorizedDeviceId && subscribedDevices.has(authorizedDeviceId)) {
      log(`[mqtt] Subscribing to authorized device ${authorizedDeviceId}`);
      subscribeToDeviceTopics(authorizedDeviceId);
    }

    // Schedule credentials refresh (presigned URLs expire after ~1 hour)
    scheduleCredentialsRefresh();

    if (onConnect) {
      onConnect();
    }
  }

  function handleDisconnect() {
    connected = false;
    lastDisconnectedAt = Date.now();

    const connectedDuration = lastConnectedAt
      ? Math.round((Date.now() - lastConnectedAt) / 1000)
      : null;

    log(
      `[mqtt] Disconnected${connectedDuration ? ` after ${connectedDuration}s uptime` : ''}`
    );

    if (onDisconnect) {
      onDisconnect();
    }
  }

  function handleError(err, context = {}) {
    if (onError) {
      onError(err, context);
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;

    reconnectAttempts++;

    // Track first failure in this sequence
    if (!firstFailureAt) {
      firstFailureAt = Date.now();
    }

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts - 1),
      RECONNECT_MAX_MS
    );

    const nextRetryAt = Date.now() + delay;
    const failureDuration = Math.round((Date.now() - firstFailureAt) / 1000);

    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      try {
        await connect();
      } catch (err) {
        const isCircuitBreakerError = err instanceof BrokenCircuitError;
        handleError(err, {
          recoverable: true,
          attempts: reconnectAttempts,
          nextRetryAt: nextRetryAt,
          circuitBreakerOpen: isCircuitBreakerError,
          failureDuration: failureDuration,
          lastConnectedAt: lastConnectedAt,
        });
        // Don't schedule reconnect if circuit breaker is open - it will handle retry timing
        if (!isCircuitBreakerError) {
          scheduleReconnect();
        }
      }
    }, delay);
  }

  function scheduleCredentialsRefresh() {
    if (credentialsRefreshTimer) {
      clearTimeout(credentialsRefreshTimer);
    }

    credentialsRefreshTimer = setTimeout(async () => {
      credentialsRefreshTimer = null;
      log('[mqtt] Refreshing MQTT credentials (presigned URL expired)');
      try {
        // Reconnect with fresh credentials
        await reconnect();
        log('[mqtt] Credentials refreshed successfully');
      } catch (err) {
        log('[mqtt] Credential refresh failed, scheduling reconnect');
        handleError(err, {
          recoverable: true,
          attempts: reconnectAttempts,
          nextRetryAt: Date.now() + RECONNECT_BASE_MS,
        });
        scheduleReconnect();
      }
    }, MQTT_CREDENTIALS_REFRESH_MS);
  }

  function subscribeToDeviceTopics(deviceId) {
    if (!client || !connected) return;

    const topics = [
      formatTopic(TOPIC_SHADOW_GET_ACCEPTED, deviceId),
      formatTopic(TOPIC_SHADOW_GET_REJECTED, deviceId),
      formatTopic(TOPIC_SHADOW_UPDATE_ACCEPTED, deviceId),
      formatTopic(TOPIC_SHADOW_UPDATE_REJECTED, deviceId),
      formatTopic(TOPIC_SHADOW_UPDATE_DELTA, deviceId),
    ];

    for (const topic of topics) {
      log(`[mqtt] Subscribing to: ${topic}`);
      client.subscribe(topic, { qos: 1 }, (err, granted) => {
        if (err) {
          log(`[mqtt] Subscribe error: ${err.message}`);
        } else if (granted) {
          log(`[mqtt] Subscribed: ${granted.map(g => g.topic).join(', ')}`);
        }
      });
    }
  }

  function unsubscribeFromDeviceTopics(deviceId) {
    if (!client || !connected) return;

    const topics = [
      formatTopic(TOPIC_SHADOW_GET_ACCEPTED, deviceId),
      formatTopic(TOPIC_SHADOW_GET_REJECTED, deviceId),
      formatTopic(TOPIC_SHADOW_UPDATE_ACCEPTED, deviceId),
      formatTopic(TOPIC_SHADOW_UPDATE_REJECTED, deviceId),
      formatTopic(TOPIC_SHADOW_UPDATE_DELTA, deviceId),
    ];

    for (const topic of topics) {
      client.unsubscribe(topic);
    }
  }

  async function connectInternal() {
    if (client) {
      log('[mqtt] Closing existing connection');
      isIntentionalDisconnect = true;

      // Wait for graceful disconnect before reconnecting
      // This prevents client_id collision when AWS IoT hasn't fully closed the old connection
      await new Promise(resolve => {
        const closeHandler = () => {
          log('[mqtt] Previous connection closed, proceeding with reconnection');
          resolve();
        };
        client.once('close', closeHandler);
        client.end(); // Graceful close (not forced)

        // Fallback timeout in case 'close' event never fires
        setTimeout(() => {
          client.removeListener('close', closeHandler);
          log('[mqtt] Close timeout, forcing disconnect');
          resolve();
        }, 5000);
      });
      client = null;
    }

    // Get fresh MQTT credentials from API
    log('[mqtt] Getting MQTT info from API...');
    currentMqttInfo = await getMqttInfo();
    if (!currentMqttInfo?.host) {
      throw new Error('No MQTT connection info available');
    }

    // Store the authorized device ID (presigned URLs are device-specific)
    authorizedDeviceId = currentMqttInfo.device_id || null;
    log(
      `[mqtt] Got MQTT info: endpoint=${currentMqttInfo.endpoint}, client_id=${currentMqttInfo.client_id}, device_id=${authorizedDeviceId}`
    );
    log(`[mqtt] WebSocket URL: ${currentMqttInfo.host.substring(0, 100)}...`);

    return new Promise((resolve, reject) => {
      // Connect using presigned WebSocket URL
      log('[mqtt] Connecting to MQTT broker...');
      client = mqttLib.connect(currentMqttInfo.host, {
        clientId: currentMqttInfo.client_id,
        protocolVersion: 4, // MQTT 3.1.1
        keepalive: 30,
        clean: true,
        reconnectPeriod: 0, // Manual reconnection
      });

      let timeoutHandle;

      client.on('connect', () => {
        log('[mqtt] Connected event received');
        clearTimeout(timeoutHandle);
        handleConnect();
        resolve();
      });

      client.on('message', handleMessage);

      client.on('close', () => {
        log('[mqtt] Close event received');
        handleDisconnect();
        if (!isIntentionalDisconnect && subscribedDevices.size > 0) {
          log(`[mqtt] ${subscribedDevices.size} subscribed devices, scheduling reconnect`);
          scheduleReconnect();
        }
        isIntentionalDisconnect = false; // Reset flag
      });

      client.on('disconnect', packet => {
        log(`[mqtt] Disconnect packet received: ${JSON.stringify(packet)}`);
      });

      client.on('offline', () => {
        log('[mqtt] Offline event');
      });

      client.on('error', err => {
        log(`[mqtt] Error event: ${err.message}`);
        clearTimeout(timeoutHandle);
        // Don't pass context here - connection hasn't succeeded yet
        // Context will be added by scheduleReconnect if this fails
        reject(err);
      });

      // Connection timeout
      timeoutHandle = setTimeout(() => {
        if (!connected) {
          const failureDuration = firstFailureAt ? Math.round((Date.now() - firstFailureAt) / 1000) : 0;
          log(`[mqtt] Connection timeout (${failureDuration}s since first failure)`);
          reject(new Error('MQTT connection timeout'));
        }
      }, 15000);
    });
  }

  async function connect() {
    return await connectionBreaker.execute(() => connectInternal());
  }

  async function reconnect() {
    const devices = Array.from(subscribedDevices);
    await connect();
    // Devices are resubscribed in handleConnect
    return devices;
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (credentialsRefreshTimer) {
      clearTimeout(credentialsRefreshTimer);
      credentialsRefreshTimer = null;
    }

    // Reject all pending requests
    for (const [, pending] of pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Disconnected'));
    }
    pendingRequests.clear();

    subscribedDevices.clear();
    if (client) {
      client.end(true);
      client = null;
    }
    connected = false;
  }

  function subscribeDevice(deviceId) {
    subscribedDevices.add(deviceId);
    // Only subscribe to topics if this is the authorized device
    if (connected && deviceId === authorizedDeviceId) {
      subscribeToDeviceTopics(deviceId);
    } else if (connected && deviceId !== authorizedDeviceId) {
      log(
        `[mqtt] Skipping subscription for ${deviceId} (not authorized, credentials are for ${authorizedDeviceId})`
      );
    }
  }

  function unsubscribeDevice(deviceId) {
    subscribedDevices.delete(deviceId);
    if (connected) {
      unsubscribeFromDeviceTopics(deviceId);
    }
  }

  /**
   * Get current device state from shadow.
   * @param {string} deviceId - Device ID
   * @param {number} [timeoutMs=10000] - Request timeout
   * @returns {Promise<object>} Shadow document
   */
  function getDeviceState(deviceId, timeoutMs = 10000) {
    if (!connected || !client) {
      return Promise.reject(new Error('Not connected'));
    }

    const requestId = `get:${deviceId}`;

    // Cancel any existing request for this device
    const existing = pendingRequests.get(requestId);
    if (existing) {
      clearTimeout(existing.timeout);
      existing.reject(new Error('Superseded by new request'));
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, timeoutMs);

      pendingRequests.set(requestId, { resolve, reject, timeout });

      // Publish to shadow/get to request state
      const topic = formatTopic(TOPIC_SHADOW_GET, deviceId);
      client.publish(topic, '{}', { qos: 1 });
    });
  }

  /**
   * Update device desired state.
   * @param {string} deviceId - Device ID
   * @param {object} desiredState - Desired state properties
   * @param {number} [timeoutMs=10000] - Request timeout
   * @returns {Promise<object>} Updated shadow document
   */
  function updateDeviceState(deviceId, desiredState, timeoutMs = 10000) {
    if (!connected || !client) {
      return Promise.reject(new Error('Not connected'));
    }

    const requestId = `update:${deviceId}`;

    // Cancel any existing request for this device
    const existing = pendingRequests.get(requestId);
    if (existing) {
      clearTimeout(existing.timeout);
      existing.reject(new Error('Superseded by new request'));
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, timeoutMs);

      pendingRequests.set(requestId, { resolve, reject, timeout });

      // Publish desired state to shadow/update
      const topic = formatTopic(TOPIC_SHADOW_UPDATE, deviceId);
      const payload = JSON.stringify({
        state: {
          desired: desiredState,
        },
      });
      vlog(`[mqtt] Publishing to ${topic}: ${payload}`);
      client.publish(topic, payload, { qos: 1 });
    });
  }

  return {
    connect,
    disconnect,
    reconnect,
    subscribeDevice,
    unsubscribeDevice,
    getDeviceState,
    updateDeviceState,
    isConnected: () => connected,
    getSubscribedDevices: () => Array.from(subscribedDevices),
    getAuthorizedDevice: () => authorizedDeviceId,
  };
}

module.exports = {
  createMqttClient,
  formatTopic,
};
