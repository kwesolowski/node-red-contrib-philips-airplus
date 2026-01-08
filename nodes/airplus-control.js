/**
 * Philips Air+ Control node.
 * Sends control commands to devices.
 */

const { buildDesiredState } = require('../lib/parser');

module.exports = function (RED) {
    function AirplusControlNode(config) {
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

        // Helper to detect payload format and convert to desired state
        function detectAndConvert(payload) {
            if (!payload || typeof payload !== 'object') {
                throw new Error('Payload must be an object');
            }

            // Format B: AWS Shadow format { state: { desired: {...} } }
            if (payload.state && payload.state.desired) {
                return payload.state.desired;
            }

            // Format A: Simple format { power: true, mode: 'auto', ... }
            return buildDesiredState(payload);
        }

        // Handle control commands
        async function handleControl(msg, send, done) {
            try {
                const desiredState = detectAndConvert(msg.payload);

                if (Object.keys(desiredState).length === 0) {
                    throw new Error('No controllable properties in payload');
                }

                // Send control command to device
                const result = await accountNode.updateDeviceState(deviceId, desiredState);

                // Add result to message and send to success port
                msg.controlResult = {
                    accepted: true,
                    timestamp: result.timestamp || Date.now(),
                    version: result.version,
                    desired: result.state?.desired || desiredState,
                };

                node.status({ fill: 'green', shape: 'dot', text: `sent: ${JSON.stringify(desiredState).substring(0, 30)}...` });

                send([msg, null]);
                if (done) done();
            } catch (err) {
                // Send error to error port
                const errorMsg = {
                    ...msg,
                    payload: null,
                    error: {
                        message: err.message,
                        code: err.code || 'ERROR',
                        deviceId: deviceId,
                        deviceName: deviceName,
                        originalPayload: msg.payload,
                    },
                };

                node.status({ fill: 'red', shape: 'ring', text: `error: ${err.message}` });

                send([null, errorMsg]);
                if (done) done(err);
            }
        }

        // Handle refresh commands
        async function handleRefresh(msg, send, done) {
            try {
                const shadowDoc = await accountNode.getDeviceState(deviceId);
                const status = shadowDoc?.state?.reported;

                if (!status) {
                    throw new Error('No reported state available');
                }

                // Replace payload with status data
                msg.payload = status;
                msg.deviceId = deviceId;
                msg.deviceName = deviceName;
                msg.updateType = 'refresh';

                node.status({ fill: 'green', shape: 'dot', text: 'refreshed' });

                send([msg, null]);
                if (done) done();
            } catch (err) {
                const errorMsg = {
                    ...msg,
                    payload: null,
                    error: {
                        message: err.message,
                        code: err.code || 'ERROR',
                        deviceId: deviceId,
                        deviceName: deviceName,
                    },
                };

                node.status({ fill: 'red', shape: 'ring', text: `error: ${err.message}` });

                send([null, errorMsg]);
                if (done) done(err);
            }
        }

        // Handle input messages
        node.on('input', async function (msg, send, done) {
            // Check if this is a refresh command
            if (msg.topic === 'refresh') {
                await handleRefresh(msg, send, done);
            } else {
                await handleControl(msg, send, done);
            }
        });

        // Update status indicator based on connection state
        function updateConnectionStatus() {
            const connected = accountNode.isConnected(deviceId);
            node.status({
                fill: connected ? 'green' : 'yellow',
                shape: connected ? 'dot' : 'ring',
                text: connected ? 'ready' : 'connecting...',
            });
        }

        // Listen to connection events for this specific device
        const onConnected = (connectedDeviceId) => {
            if (connectedDeviceId === deviceId) {
                updateConnectionStatus();
            }
        };

        const onDisconnected = (disconnectedDeviceId) => {
            if (disconnectedDeviceId === deviceId) {
                updateConnectionStatus();
            }
        };

        accountNode.on('connected', onConnected);
        accountNode.on('disconnected', onDisconnected);

        // Cleanup on close
        node.on('close', function (done) {
            accountNode.removeListener('connected', onConnected);
            accountNode.removeListener('disconnected', onDisconnected);
            done();
        });

        // Initialize status
        updateConnectionStatus();
    }

    RED.nodes.registerType('airplus-control', AirplusControlNode);
};
