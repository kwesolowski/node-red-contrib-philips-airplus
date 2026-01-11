/**
 * Philips Air+ Status node.
 * Subscribes to a device and outputs status updates.
 */

module.exports = function (RED) {
  function AirplusStatusNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Configuration
    const accountNodeId = config.account;
    const deviceId = config.device;
    const deviceName = config.deviceName || deviceId;

    // Get account node
    const accountNode = RED.nodes.getNode(accountNodeId);

    if (!accountNode) {
      node.status({ fill: 'red', shape: 'ring', text: 'no account configured' });
      node.error('No account node configured');
      return;
    }

    if (!deviceId) {
      node.status({ fill: 'red', shape: 'ring', text: 'no device selected' });
      node.error('No device selected');
      return;
    }

    // Track last known status for display when disconnected
    let lastStatus = null;

    // Status callback
    function onStatusUpdate(status, type) {
      lastStatus = status;

      const msg = {
        payload: status,
        deviceId: deviceId,
        deviceName: deviceName,
        topic: `${deviceId}/${type}`,
        updateType: type,
      };

      node.send(msg);

      // Update node status with key metrics
      updateNodeStatus(status);
    }

    function updateNodeStatus(status) {
      if (!status) {
        node.status({ fill: 'grey', shape: 'ring', text: 'waiting...' });
        return;
      }

      const parts = [];

      if (status.power !== undefined) {
        parts.push(status.power ? 'ON' : 'OFF');
      }

      if (status.pm25 !== undefined) {
        parts.push(`PM2.5: ${status.pm25}`);
      }

      if (status.humidity !== undefined) {
        parts.push(`${status.humidity}%`);
      }

      if (parts.length > 0) {
        const connected = accountNode.isConnected(deviceId);
        node.status({
          fill: connected ? 'green' : 'yellow',
          shape: connected ? 'dot' : 'ring',
          text: parts.join(' | '),
        });
      }
    }

    // Subscribe to device updates
    async function subscribe() {
      const currentStatus = accountNode.subscribe(deviceId, onStatusUpdate);
      if (currentStatus) {
        // Emit current status immediately
        onStatusUpdate(currentStatus, 'initial');
      } else {
        node.status({ fill: 'yellow', shape: 'ring', text: 'fetching...' });
        // No cached status - request fresh state immediately
        try {
          const shadowDoc = await accountNode.getDeviceState(deviceId);
          const status = shadowDoc?.state?.reported;
          if (status) {
            onStatusUpdate(status, 'initial');
          }
        } catch (err) {
          node.warn(`Failed to fetch initial state: ${err.message}`);
          node.status({ fill: 'yellow', shape: 'ring', text: 'waiting for updates...' });
        }
      }
    }

    // Listen to connection events for this specific device
    const onConnected = connectedDeviceId => {
      if (connectedDeviceId === deviceId) {
        // Device just connected - subscribe to updates
        subscribe();
      }
    };

    const onDisconnected = disconnectedDeviceId => {
      if (disconnectedDeviceId === deviceId) {
        // Device disconnected - update status to show stale data
        if (lastStatus) {
          updateNodeStatus(lastStatus);
        } else {
          node.status({ fill: 'yellow', shape: 'ring', text: 'disconnected' });
        }
      }
    };

    accountNode.on('connected', onConnected);
    accountNode.on('disconnected', onDisconnected);

    // Set initial status before checking connection
    node.status({ fill: 'grey', shape: 'ring', text: 'initializing...' });

    // Wait for account node to be ready
    if (accountNode.isConnected(deviceId)) {
      subscribe();
    } else {
      node.status({ fill: 'yellow', shape: 'ring', text: 'waiting for connection...' });
    }

    // Handle manual trigger input
    node.on('input', async function (msg, send, done) {
      try {
        // Trigger shadow GET - subscription callback will emit when response arrives
        await accountNode.getDeviceState(deviceId);
        if (done) done();
      } catch (err) {
        node.error(`Failed to get device state: ${err.message}`);
        if (done) done(err);
      }
    });

    // Cleanup on close
    node.on('close', function (done) {
      accountNode.unsubscribe(deviceId, onStatusUpdate);
      accountNode.removeListener('connected', onConnected);
      accountNode.removeListener('disconnected', onDisconnected);
      done();
    });
  }

  RED.nodes.registerType('airplus-status', AirplusStatusNode);
};
