/**
 * airplus-account keeps the last shadow message per device and topic and serves it on
 * GET /philips-airplus/last-shadow behind the airplus-account.read permission.
 */

const fs = require('fs');

jest.mock('../lib/api', () => ({ createApiClient: jest.fn() }));
jest.mock('../lib/mqtt', () => ({ createMqttClient: jest.fn() }));
const { createApiClient } = require('../lib/api');
const { createMqttClient } = require('../lib/mqtt');
const { fakeMqttClient, createAccountNode } = require('./helpers/account-node');

const DEVICE = { id: 'dev-1', name: 'Bedroom' };
const GET_TOPIC = '$aws/things/dev-1/shadow/get/accepted';
const UPDATE_TOPIC = '$aws/things/dev-1/shadow/update/accepted';

async function connectedAccount() {
  const clients = [];
  createMqttClient.mockImplementation(options => {
    const client = fakeMqttClient(options);
    clients.push(client);
    return client;
  });
  createApiClient.mockReturnValue({
    listDevices: jest.fn().mockResolvedValue([DEVICE]),
    getMqttInfo: jest.fn().mockResolvedValue([{ device_id: DEVICE.id }]),
  });
  const account = createAccountNode();
  await new Promise(setImmediate);
  return { ...account, client: clients[0] };
}

function callRoute(routes, path) {
  const handlers = routes.get(path);
  const res = { json: jest.fn() };
  handlers[handlers.length - 1]({ query: {} }, res);
  return { handlers, body: res.json.mock.calls[0][0] };
}

describe('airplus-account last shadow', () => {
  beforeEach(() => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  test('keeps the latest message for each topic of a device', async () => {
    const { node, client } = await connectedAccount();
    const first = { state: { reported: { D03125: 50 } }, version: 1 };
    const second = { state: { reported: { D03125: 52 } }, version: 2 };
    const update = { state: { reported: { D03125: 53 } }, version: 3 };

    client.options.onShadowMessage(DEVICE.id, GET_TOPIC, first);
    client.options.onShadowMessage(DEVICE.id, GET_TOPIC, second);
    client.options.onShadowMessage(DEVICE.id, UPDATE_TOPIC, update);

    const shadows = node.getLastShadows();
    expect(Object.keys(shadows)).toEqual([DEVICE.id]);
    expect(shadows[DEVICE.id][GET_TOPIC].message).toBe(second);
    expect(shadows[DEVICE.id][UPDATE_TOPIC].message).toBe(update);
    expect(Date.parse(shadows[DEVICE.id][GET_TOPIC].receivedAt)).not.toBeNaN();
  });

  test('the route needs the read permission and returns shadows by account id', async () => {
    const { routes, client } = await connectedAccount();
    const document = { state: { reported: { D03125: 50 } } };
    client.options.onShadowMessage(DEVICE.id, GET_TOPIC, document);

    const { handlers, body } = callRoute(routes, '/philips-airplus/last-shadow');

    expect(handlers[0]).toEqual({ permission: 'airplus-account.read' });
    expect(body['account-1'][DEVICE.id][GET_TOPIC].message).toBe(document);
  });
});
