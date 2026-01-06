/**
 * Tests for MxChip API module.
 */

const { createApiClient, generateSignature, parseDevice } = require('../lib/api');

describe('api', () => {
    describe('generateSignature', () => {
        it('generates signature for known test vector', () => {
            // Known test vector from Frida capture
            const appId = '9fd505fa9c7111e9a1e3061302926720';
            const timestamp = '1767670901';
            const username = 'ahc:id=5790965ee892b099963b9937a45f4510';

            const signature = generateSignature(appId, timestamp, username);

            // This is the expected signature from the reverse-engineered docs
            expect(signature).toBe('1dd7def42a90e33a71b58037273400c73799b379bdeaa298aada4192962103a0');
        });

        it('generates different signatures for different timestamps', () => {
            const appId = '9fd505fa9c7111e9a1e3061302926720';
            const username = 'PHILIPS:user-123';

            const sig1 = generateSignature(appId, '1000000', username);
            const sig2 = generateSignature(appId, '2000000', username);

            expect(sig1).not.toBe(sig2);
        });

        it('generates different signatures for different users', () => {
            const appId = '9fd505fa9c7111e9a1e3061302926720';
            const timestamp = '1000000';

            const sig1 = generateSignature(appId, timestamp, 'user1');
            const sig2 = generateSignature(appId, timestamp, 'user2');

            expect(sig1).not.toBe(sig2);
        });

        it('URL encodes special characters in username', () => {
            const appId = '9fd505fa9c7111e9a1e3061302926720';
            const timestamp = '1000000';
            const username = 'PHILIPS:uuid-with:colons';

            // Should not throw and should produce consistent output
            const sig = generateSignature(appId, timestamp, username);
            expect(sig).toMatch(/^[a-f0-9]{64}$/);
        });
    });

    describe('createApiClient', () => {
        function createMockFetch(responses) {
            let callIndex = 0;
            return jest.fn().mockImplementation(() => {
                const response = Array.isArray(responses) ? responses[callIndex++] : responses;
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(response),
                    ...response,
                });
            });
        }

        describe('getServerTime', () => {
            it('fetches server time', async () => {
                const mockFetch = createMockFetch({
                    data: { timestamp1: 1767669312 },
                    meta: { code: 0 },
                });

                const client = createApiClient({ fetchFn: mockFetch });
                const result = await client.getServerTime();

                expect(result.timestamp).toBe('1767669312');
                expect(mockFetch).toHaveBeenCalledWith(
                    expect.stringContaining('/device/serverTime/'),
                    expect.objectContaining({
                        headers: expect.objectContaining({
                            'User-Agent': expect.stringContaining('MxChip'),
                        }),
                    })
                );
            });

            it('throws on API error', async () => {
                const mockFetch = jest.fn().mockResolvedValue({
                    ok: false,
                    status: 500,
                });

                const client = createApiClient({ fetchFn: mockFetch });
                await expect(client.getServerTime()).rejects.toThrow('Server time failed');
            });
        });

        describe('listDevices', () => {
            it('fetches and parses device list', async () => {
                const mockFetch = createMockFetch([
                    // getServerTime response
                    { data: { timestamp1: 1767669312 }, meta: { code: 0 } },
                    // getToken response
                    { data: { token: 'jwt-token' }, meta: { code: 0 } },
                    // listDevices response
                    {
                        data: [
                            {
                                device_id: 'dev-123',
                                device_info: {
                                    name: 'Living Room',
                                    modelid: 'AC3737/10',
                                    type: 'Carnation',
                                    mac: '849DC2BFEEC6',
                                    is_online: true,
                                },
                            },
                        ],
                        meta: { code: 0 },
                    },
                ]);

                const client = createApiClient({ fetchFn: mockFetch });
                const devices = await client.listDevices('PHILIPS:user-123');

                expect(devices).toHaveLength(1);
                expect(devices[0].id).toBe('dev-123');
                expect(devices[0].name).toBe('Living Room');
                expect(devices[0].model).toBe('AC3737/10');
                expect(devices[0].isOnline).toBe(true);
            });

            it('includes signature header in token request', async () => {
                const mockFetch = createMockFetch([
                    { data: { timestamp1: 1000000 }, meta: { code: 0 } },
                    { data: { token: 'jwt-token' }, meta: { code: 0 } },
                    { data: [], meta: { code: 0 } },
                ]);

                const client = createApiClient({ fetchFn: mockFetch });
                await client.listDevices('PHILIPS:user-123');

                // Second call is getToken
                const tokenCall = mockFetch.mock.calls[1];
                expect(tokenCall[1].headers.signature).toMatch(/^[a-f0-9]{64}$/);
            });

            it('uses jwt Authorization header', async () => {
                const mockFetch = createMockFetch([
                    { data: { timestamp1: 1000000 }, meta: { code: 0 } },
                    { data: { token: 'my-jwt-token' }, meta: { code: 0 } },
                    { data: [], meta: { code: 0 } },
                ]);

                const client = createApiClient({ fetchFn: mockFetch });
                await client.listDevices('PHILIPS:user-123');

                // Third call is listDevices
                const listCall = mockFetch.mock.calls[2];
                expect(listCall[1].headers.Authorization).toBe('jwt my-jwt-token');
            });

            it('caches token for subsequent calls', async () => {
                const mockFetch = createMockFetch([
                    { data: { timestamp1: 1000000 }, meta: { code: 0 } },
                    { data: { token: 'jwt-token' }, meta: { code: 0 } },
                    { data: [], meta: { code: 0 } },
                    { data: [], meta: { code: 0 } },
                ]);

                const client = createApiClient({ fetchFn: mockFetch });
                await client.listDevices('PHILIPS:user-123');
                await client.listDevices('PHILIPS:user-123');

                // Should only call getToken once
                const tokenCalls = mockFetch.mock.calls.filter((c) =>
                    c[0].includes('getToken')
                );
                expect(tokenCalls).toHaveLength(1);
            });
        });

        describe('getMqttInfo', () => {
            it('fetches MQTT connection info', async () => {
                const mockFetch = createMockFetch([
                    { data: { timestamp1: 1000000 }, meta: { code: 0 } },
                    { data: { token: 'jwt-token' }, meta: { code: 0 } },
                    {
                        data: {
                            mqttinfos: [
                                {
                                    host: 'wss://mqtt.example.com/mqtt?auth=sig',
                                    endpoint: 'mqtt.example.com',
                                    client_id: 'client-123',
                                    device_id: 'dev-123',
                                },
                            ],
                        },
                        meta: { code: 0 },
                    },
                ]);

                const client = createApiClient({ fetchFn: mockFetch });
                const mqttInfos = await client.getMqttInfo('PHILIPS:user-123', ['dev-123']);

                expect(mqttInfos).toHaveLength(1);
                expect(mqttInfos[0].host).toContain('wss://');
                expect(mqttInfos[0].client_id).toBe('client-123');
            });

            it('sends device_id array in request body', async () => {
                const mockFetch = createMockFetch([
                    { data: { timestamp1: 1000000 }, meta: { code: 0 } },
                    { data: { token: 'jwt-token' }, meta: { code: 0 } },
                    { data: { mqttinfos: [] }, meta: { code: 0 } },
                ]);

                const client = createApiClient({ fetchFn: mockFetch });
                await client.getMqttInfo('PHILIPS:user-123', ['dev-1', 'dev-2']);

                // Third call is getMqttInfo
                const mqttCall = mockFetch.mock.calls[2];
                const body = JSON.parse(mqttCall[1].body);
                expect(body.device_id).toEqual(['dev-1', 'dev-2']);
            });
        });
    });

    describe('parseDevice', () => {
        it('parses device with all fields', () => {
            const raw = {
                device_id: 'dev-123',
                device_info: {
                    name: 'Bedroom',
                    device_alias: 'Old Name',
                    modelid: 'AC3737/10',
                    type: 'Carnation',
                    mac: 'AABBCCDDEEFF',
                    is_online: true,
                    swversion: '1.2.3',
                    service_region: 'eu-central-1',
                },
            };

            const result = parseDevice(raw);

            expect(result.id).toBe('dev-123');
            expect(result.name).toBe('Bedroom');
            expect(result.model).toBe('AC3737/10');
            expect(result.type).toBe('Carnation');
            expect(result.mac).toBe('AABBCCDDEEFF');
            expect(result.isOnline).toBe(true);
            expect(result.swVersion).toBe('1.2.3');
            expect(result.serviceRegion).toBe('eu-central-1');
            expect(result.raw).toBe(raw);
        });

        it('falls back to device_alias when name missing', () => {
            const raw = {
                device_id: 'dev-123',
                device_info: {
                    device_alias: 'Alias Name',
                },
            };

            const result = parseDevice(raw);
            expect(result.name).toBe('Alias Name');
        });

        it('handles missing device_info', () => {
            const raw = {
                device_id: 'dev-123',
            };

            const result = parseDevice(raw);
            expect(result.id).toBe('dev-123');
            expect(result.name).toBe('Unknown Device');
        });
    });
});
