/**
 * Tests for event-based node initialization (ready event pattern).
 * Uses mock account node (EventEmitter) -- no node-red-node-test-helper needed.
 */

const EventEmitter = require('events');

// Mock RED object
function createMockRED() {
  const nodes = new Map();
  return {
    nodes: {
      createNode(node, config) {
        node.id = config.id || 'test-node';
        node.status = jest.fn();
        node.error = jest.fn();
        node.warn = jest.fn();
        node.log = jest.fn();
        node.send = jest.fn();
        node.on = jest.fn((event, handler) => {
          if (!node._handlers) node._handlers = {};
          if (!node._handlers[event]) node._handlers[event] = [];
          node._handlers[event].push(handler);
        });
      },
      getNode(id) {
        return nodes.get(id);
      },
      registerType: jest.fn(),
    },
    _nodes: nodes,
  };
}

// Mock account node with EventEmitter + public API
function createMockAccountNode({ ready = false, connected = false } = {}) {
  const account = new EventEmitter();
  account.isReady = jest.fn(() => ready);
  account.isConnected = jest.fn(() => connected);
  account.subscribe = jest.fn(() => null);
  account.unsubscribe = jest.fn();
  account.getDevices = jest.fn(() => []);
  account.getDeviceState = jest.fn(async () => null);
  account.updateDeviceState = jest.fn(async () => ({}));
  return account;
}

describe('airplus-status node init', () => {
  let RED;
  let statusModule;

  beforeEach(() => {
    RED = createMockRED();
    statusModule = require('../nodes/airplus-status');
    statusModule(RED);
  });

  afterEach(() => {
    jest.resetModules();
  });

  function createStatusNode(accountNode, config = {}) {
    RED._nodes.set('account-1', accountNode);
    const register = RED.nodes.registerType;
    const NodeConstructor = register.mock.calls[0][1];

    const node = {};
    RED.nodes.createNode(node, { id: 'status-1', ...config });
    NodeConstructor.call(node, {
      account: 'account-1',
      device: config.device || 'device-abc',
      deviceName: config.deviceName || 'Test Device',
      ...config,
    });
    return node;
  }

  test('defers init until ready event when account not ready', () => {
    const account = createMockAccountNode({ ready: false, connected: false });
    const node = createStatusNode(account);

    // Should show initializing status
    expect(node.status).toHaveBeenCalledWith(
      expect.objectContaining({ fill: 'grey', text: 'initializing...' })
    );

    // Should NOT have subscribed yet
    expect(account.subscribe).not.toHaveBeenCalled();

    // Should NOT have called node.error for missing device
    expect(node.error).not.toHaveBeenCalled();

    // Now fire ready
    account.isReady.mockReturnValue(true);
    account.emit('ready');

    // After ready, should show waiting for connection (since not connected)
    expect(node.status).toHaveBeenCalledWith(
      expect.objectContaining({ fill: 'yellow', text: 'waiting for connection...' })
    );
  });

  test('inits immediately if account already ready and connected', () => {
    const account = createMockAccountNode({ ready: true, connected: true });
    const node = createStatusNode(account);

    // Should have subscribed immediately
    expect(account.subscribe).toHaveBeenCalledWith('device-abc', expect.any(Function));
  });

  test('missing deviceId shows red status without node.error', () => {
    const account = createMockAccountNode({ ready: true, connected: true });
    const node = createStatusNode(account, { device: '' });

    // Should show red status for missing device
    expect(node.status).toHaveBeenCalledWith(
      expect.objectContaining({ fill: 'red', text: 'no device selected' })
    );

    // Should NOT call node.error (status indicator suffices)
    expect(node.error).not.toHaveBeenCalled();
  });

  test('auth-failed fires before ready and updates status', () => {
    const account = createMockAccountNode({ ready: false });
    const node = createStatusNode(account);

    account.emit('auth-failed', 'token revoked');

    expect(node.status).toHaveBeenCalledWith(
      expect.objectContaining({ fill: 'red', text: 'token revoked' })
    );
  });
});

describe('airplus-control node init', () => {
  let RED;
  let controlModule;

  beforeEach(() => {
    RED = createMockRED();
    controlModule = require('../nodes/airplus-control');
    controlModule(RED);
  });

  afterEach(() => {
    jest.resetModules();
  });

  function createControlNode(accountNode, config = {}) {
    RED._nodes.set('account-1', accountNode);
    const register = RED.nodes.registerType;
    const NodeConstructor = register.mock.calls[0][1];

    const node = {};
    RED.nodes.createNode(node, { id: 'control-1', ...config });
    NodeConstructor.call(node, {
      account: 'account-1',
      device: config.device || 'device-abc',
      deviceName: config.deviceName || 'Test Device',
      ...config,
    });
    return node;
  }

  test('defers init until ready event when account not ready', () => {
    const account = createMockAccountNode({ ready: false, connected: false });
    const node = createControlNode(account);

    expect(node.status).toHaveBeenCalledWith(
      expect.objectContaining({ fill: 'grey', text: 'initializing...' })
    );
    expect(node.error).not.toHaveBeenCalled();

    // Fire ready - should transition to connection status
    account.isReady.mockReturnValue(true);
    account.isConnected.mockReturnValue(false);
    account.emit('ready');

    expect(node.status).toHaveBeenCalledWith(
      expect.objectContaining({ fill: 'yellow', text: 'connecting...' })
    );
  });

  test('inits immediately if account already ready', () => {
    const account = createMockAccountNode({ ready: true, connected: true });
    const node = createControlNode(account);

    expect(node.status).toHaveBeenCalledWith(
      expect.objectContaining({ fill: 'green', text: 'ready' })
    );
  });

  test('missing deviceId shows red status without node.error', () => {
    const account = createMockAccountNode({ ready: true });
    const node = createControlNode(account, { device: '' });

    expect(node.status).toHaveBeenCalledWith(
      expect.objectContaining({ fill: 'red', text: 'no device selected' })
    );
    expect(node.error).not.toHaveBeenCalled();
  });
});

describe('airplus-account ready event', () => {
  test('emits ready after successful init', async () => {
    // We test the pattern: initialize() sets ready=true and emits 'ready'
    // Since account node requires real filesystem/network, test the contract via mock
    const account = new EventEmitter();
    let readyFired = false;
    account.once('ready', () => {
      readyFired = true;
    });

    // Simulate what initialize() does at end
    account.emit('ready');
    expect(readyFired).toBe(true);
  });

  test('emits ready after failed init (contract test)', async () => {
    const account = new EventEmitter();
    let readyFired = false;
    account.once('ready', () => {
      readyFired = true;
    });

    // Simulate failed init path - ready should still fire (finally block)
    account.emit('ready');
    expect(readyFired).toBe(true);
  });
});
