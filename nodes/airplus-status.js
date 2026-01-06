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

        // Status callback
        function onStatusUpdate(status, type) {
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
                const connected = accountNode.isConnected();
                node.status({
                    fill: connected ? 'green' : 'yellow',
                    shape: connected ? 'dot' : 'ring',
                    text: parts.join(' | '),
                });
            }
        }

        // Subscribe to device updates
        function subscribe() {
            const currentStatus = accountNode.subscribe(deviceId, onStatusUpdate);
            if (currentStatus) {
                // Emit current status immediately
                onStatusUpdate(currentStatus, 'initial');
            } else {
                node.status({ fill: 'yellow', shape: 'ring', text: 'connecting...' });
            }
        }

        // Wait for account node to be ready
        if (accountNode.isConnected()) {
            subscribe();
        } else {
            // Retry subscription after a delay
            const retryInterval = setInterval(() => {
                if (accountNode.isConnected()) {
                    clearInterval(retryInterval);
                    subscribe();
                }
            }, 2000);

            // Give up after 60 seconds
            setTimeout(() => {
                clearInterval(retryInterval);
                if (!accountNode.isConnected()) {
                    node.status({ fill: 'red', shape: 'ring', text: 'connection timeout' });
                }
            }, 60000);

            node.on('close', () => clearInterval(retryInterval));
        }

        // Handle manual trigger input
        node.on('input', function (msg, send, done) {
            // Output current status on demand
            const status = accountNode.getDeviceStatus(deviceId);
            if (status) {
                send({
                    payload: status,
                    deviceId: deviceId,
                    deviceName: deviceName,
                    topic: `${deviceId}/status`,
                    updateType: 'manual',
                });
            } else {
                node.warn('No status available for device');
            }
            if (done) done();
        });

        // Cleanup on close
        node.on('close', function (done) {
            accountNode.unsubscribe(deviceId, onStatusUpdate);
            done();
        });

        node.status({ fill: 'grey', shape: 'ring', text: 'initializing...' });
    }

    RED.nodes.registerType('airplus-status', AirplusStatusNode);
};
