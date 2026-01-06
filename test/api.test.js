const { createApiClient, parseDeviceList, normalizeDeviceId } = require('../lib/api');

describe('api', () => {
    describe('createApiClient', () => {
        function createMockFetch(response) {
            return jest.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(response),
            });
        }

        function createErrorFetch(status, text) {
            return jest.fn().mockResolvedValue({
                ok: false,
                status,
                text: () => Promise.resolve(text),
            });
        }

        describe('listDevices', () => {
            it('fetches and parses device list', async () => {
                const mockFetch = createMockFetch({
                    devices: [
                        { uuid: 'abc123', name: 'Living Room', modelId: 'AC3737' },
                        { uuid: 'def456', name: 'Bedroom', modelId: 'AC2729' },
                    ],
                });

                const client = createApiClient({
                    getToken: () => Promise.resolve('test-token'),
                    fetchFn: mockFetch,
                });

                const devices = await client.listDevices();

                expect(devices).toHaveLength(2);
                expect(devices[0].name).toBe('Living Room');
                expect(devices[0].model).toBe('AC3737');
                expect(devices[0].id).toContain('da-');
            });

            it('includes Authorization header', async () => {
                const mockFetch = createMockFetch({ devices: [] });

                const client = createApiClient({
                    getToken: () => Promise.resolve('my-token'),
                    fetchFn: mockFetch,
                });

                await client.listDevices();

                expect(mockFetch).toHaveBeenCalledWith(
                    expect.stringContaining('/device'),
                    expect.objectContaining({
                        headers: expect.objectContaining({
                            Authorization: 'Bearer my-token',
                        }),
                    })
                );
            });

            it('throws on API error', async () => {
                const mockFetch = createErrorFetch(401, 'Unauthorized');

                const client = createApiClient({
                    getToken: () => Promise.resolve('bad-token'),
                    fetchFn: mockFetch,
                });

                await expect(client.listDevices()).rejects.toThrow('API error: 401');
            });
        });

        describe('getSignature', () => {
            it('fetches MQTT signature', async () => {
                const mockFetch = createMockFetch({
                    signature: 'sig-abc123',
                    authorizerName: 'CustomAuthorizer',
                });

                const client = createApiClient({
                    getToken: () => Promise.resolve('token'),
                    fetchFn: mockFetch,
                });

                const result = await client.getSignature();

                expect(result.signature).toBe('sig-abc123');
                expect(result.authorizerName).toBe('CustomAuthorizer');
            });

            it('uses default authorizer name if not in response', async () => {
                const mockFetch = createMockFetch({
                    signature: 'sig-abc123',
                });

                const client = createApiClient({
                    getToken: () => Promise.resolve('token'),
                    fetchFn: mockFetch,
                });

                const result = await client.getSignature();

                expect(result.authorizerName).toBe('CustomAuthorizer');
            });

            it('throws if signature missing', async () => {
                const mockFetch = createMockFetch({});

                const client = createApiClient({
                    getToken: () => Promise.resolve('token'),
                    fetchFn: mockFetch,
                });

                await expect(client.getSignature()).rejects.toThrow('Signature missing');
            });
        });

        describe('getUserInfo', () => {
            it('fetches user info', async () => {
                const mockFetch = createMockFetch({
                    id: 'user-123',
                    email: 'test@example.com',
                });

                const client = createApiClient({
                    getToken: () => Promise.resolve('token'),
                    fetchFn: mockFetch,
                });

                const result = await client.getUserInfo();

                expect(result.id).toBe('user-123');
                expect(result.email).toBe('test@example.com');
            });
        });
    });

    describe('parseDeviceList', () => {
        it('parses devices array in object', () => {
            const data = {
                devices: [
                    { uuid: 'abc', name: 'Device1' },
                    { uuid: 'def', name: 'Device2' },
                ],
            };

            const result = parseDeviceList(data);

            expect(result).toHaveLength(2);
            expect(result[0].name).toBe('Device1');
        });

        it('parses direct array', () => {
            const data = [
                { uuid: 'abc', name: 'Device1' },
                { uuid: 'def', name: 'Device2' },
            ];

            const result = parseDeviceList(data);

            expect(result).toHaveLength(2);
        });

        it('handles nested array with uuid entries', () => {
            const data = {
                someKey: [{ uuid: 'abc', name: 'Device1' }],
            };

            const result = parseDeviceList(data);

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Device1');
        });

        it('handles missing name fields', () => {
            const data = { devices: [{ uuid: 'abc', modelId: 'AC3737' }] };

            const result = parseDeviceList(data);

            expect(result[0].name).toBe('AC3737');
        });

        it('includes raw device data', () => {
            const data = {
                devices: [{ uuid: 'abc', name: 'D1', extra: 'field' }],
            };

            const result = parseDeviceList(data);

            expect(result[0].raw.extra).toBe('field');
        });

        it('handles empty response', () => {
            expect(parseDeviceList(null)).toEqual([]);
            expect(parseDeviceList({})).toEqual([]);
            expect(parseDeviceList([])).toEqual([]);
        });
    });

    describe('normalizeDeviceId', () => {
        it('adds da- prefix to bare id', () => {
            expect(normalizeDeviceId('abc123')).toBe('da-abc123');
        });

        it('preserves existing da- prefix', () => {
            expect(normalizeDeviceId('da-abc123')).toBe('da-abc123');
        });

        it('converts 32-char hex to UUID format', () => {
            const hex = '12345678901234567890123456789012';
            const result = normalizeDeviceId(hex);

            expect(result).toBe('da-12345678-9012-3456-7890-123456789012');
        });

        it('handles empty/null input', () => {
            expect(normalizeDeviceId('')).toBe('unknown');
            expect(normalizeDeviceId(null)).toBe('unknown');
            expect(normalizeDeviceId(undefined)).toBe('unknown');
        });
    });
});
