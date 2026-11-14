/**
 * Builds an airplus-account node against a minimal fake RED runtime.
 * Tests must jest.mock('../lib/api') and '../lib/mqtt' themselves (jest.mock is hoisted per file).
 */

const EventEmitter = require('events');

function fakeMqttClient(options) {
  let connected = false;
  return {
    options,
    connect: jest.fn(async () => {
      connected = true;
      options.onConnect();
    }),
    disconnect: jest.fn(() => {
      connected = false;
    }),
    subscribeDevice: jest.fn(),
    isConnected: () => connected,
  };
}

/**
 * @returns {{ node: object, routes: Map<string, Function[]> }} the node and the admin GET handlers by path
 */
function createAccountNode({ expiresAt } = {}) {
  let NodeConstructor;
  const routes = new Map();
  const nodes = new Map();
  const RED = {
    nodes: {
      createNode(node, config) {
        Object.assign(node, new EventEmitter());
        Object.setPrototypeOf(node, EventEmitter.prototype);
        node.id = config.id;
        node.credentials = config.credentials;
        node.log = jest.fn();
        node.warn = jest.fn();
        node.error = jest.fn();
        node.status = jest.fn();
        nodes.set(config.id, node);
      },
      addCredentials: jest.fn(),
      registerType: jest.fn((type, ctor) => {
        NodeConstructor = ctor;
      }),
      getNode: id => nodes.get(id),
      eachNode: callback => nodes.forEach((_, id) => callback({ id, type: 'airplus-account' })),
    },
    auth: { needsPermission: permission => ({ permission }) },
    httpAdmin: {
      get: jest.fn((path, ...handlers) => routes.set(path, handlers)),
      post: jest.fn(),
    },
  };
  require('../../nodes/airplus-account')(RED);

  const node = {};
  const farFuture = String(Math.floor(Date.now() / 1000) + 24 * 3600);
  NodeConstructor.call(node, {
    id: 'account-1',
    credentials: {
      userId: 'user-1',
      refreshToken: 'refresh-1',
      expiresAt: expiresAt ?? farFuture,
    },
  });
  return { node, routes };
}

module.exports = { fakeMqttClient, createAccountNode };
