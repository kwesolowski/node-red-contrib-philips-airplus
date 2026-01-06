const {
    generatePkce,
    buildAuthUrl,
    parseRedirectUrl,
    exchangeCode,
    refreshTokens,
    extractUserId,
    isTokenExpired,
} = require('../lib/oauth');

describe('oauth', () => {
    describe('generatePkce', () => {
        it('generates verifier and challenge', () => {
            const { verifier, challenge } = generatePkce();
            expect(verifier).toBeDefined();
            expect(challenge).toBeDefined();
            expect(verifier.length).toBeGreaterThan(20);
            expect(challenge.length).toBeGreaterThan(20);
        });

        it('generates unique values each time', () => {
            const a = generatePkce();
            const b = generatePkce();
            expect(a.verifier).not.toBe(b.verifier);
            expect(a.challenge).not.toBe(b.challenge);
        });

        it('challenge is SHA256 of verifier in base64url', () => {
            const crypto = require('crypto');
            const { verifier, challenge } = generatePkce();
            const expected = crypto
                .createHash('sha256')
                .update(verifier)
                .digest('base64url');
            expect(challenge).toBe(expected);
        });
    });

    describe('buildAuthUrl', () => {
        it('builds valid authorization URL', () => {
            const url = buildAuthUrl('test-challenge', 'test-state');
            expect(url).toContain('cdc.accounts.home.id');
            expect(url).toContain('code_challenge=test-challenge');
            expect(url).toContain('code_challenge_method=S256');
            expect(url).toContain('state=test-state');
            expect(url).toContain('response_type=code');
        });

        it('includes required scopes', () => {
            const url = buildAuthUrl('challenge', 'state');
            expect(url).toContain('openid');
            expect(url).toContain('DI.Account.read');
        });

        it('includes client_id', () => {
            const url = buildAuthUrl('challenge', 'state');
            expect(url).toContain('client_id=-XsK7O6iEkLml77yDGDUi0ku');
        });
    });

    describe('parseRedirectUrl', () => {
        it('parses full redirect URL', () => {
            const input = 'com.philips.air://loginredirect?code=st2.abc123.sc3&state=node-id';
            const { code, state } = parseRedirectUrl(input);
            expect(code).toBe('st2.abc123.sc3');
            expect(state).toBe('node-id');
        });

        it('parses URL with extra parameters', () => {
            const input = 'com.philips.air://loginredirect?code=abc&state=xyz&extra=ignored';
            const { code, state } = parseRedirectUrl(input);
            expect(code).toBe('abc');
            expect(state).toBe('xyz');
        });

        it('handles quoted input', () => {
            const input = '"com.philips.air://loginredirect?code=abc&state=xyz"';
            const { code } = parseRedirectUrl(input);
            expect(code).toBe('abc');
        });

        it('handles bare code', () => {
            const input = 'st2.abc123.sc3';
            const { code, state } = parseRedirectUrl(input);
            expect(code).toBe('st2.abc123.sc3');
            expect(state).toBeNull();
        });

        it('handles bare code with accidental state suffix', () => {
            const input = 'st2.abc123.sc3&state=xyz';
            const { code } = parseRedirectUrl(input);
            expect(code).toBe('st2.abc123.sc3');
        });

        it('throws on missing code parameter', () => {
            const input = 'com.philips.air://loginredirect?state=xyz';
            expect(() => parseRedirectUrl(input)).toThrow('code parameter missing');
        });

        it('throws on URL without query params', () => {
            const input = 'com.philips.air://loginredirect';
            expect(() => parseRedirectUrl(input)).toThrow('no query parameters');
        });
    });

    describe('exchangeCode', () => {
        it('exchanges code for tokens', async () => {
            const mockFetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        access_token: 'access-123',
                        refresh_token: 'refresh-456',
                        expires_in: 3600,
                    }),
            });

            const result = await exchangeCode('code', 'verifier', mockFetch);

            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('token'),
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('code=code'),
                })
            );
            expect(result.accessToken).toBe('access-123');
            expect(result.refreshToken).toBe('refresh-456');
            expect(result.expiresAt).toBeGreaterThan(Date.now());
        });

        it('throws on error response', async () => {
            const mockFetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 400,
                text: () => Promise.resolve('invalid_grant'),
            });

            await expect(exchangeCode('code', 'verifier', mockFetch)).rejects.toThrow(
                'Token exchange failed: 400'
            );
        });

        it('includes code_verifier in request', async () => {
            const mockFetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        access_token: 'x',
                        refresh_token: 'y',
                        expires_in: 3600,
                    }),
            });

            await exchangeCode('the-code', 'the-verifier', mockFetch);

            const body = mockFetch.mock.calls[0][1].body;
            expect(body).toContain('code_verifier=the-verifier');
        });
    });

    describe('refreshTokens', () => {
        it('refreshes tokens successfully', async () => {
            const mockFetch = jest.fn().mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        access_token: 'new-access',
                        refresh_token: 'new-refresh',
                        expires_in: 7200,
                    }),
            });

            const result = await refreshTokens('old-refresh', mockFetch);

            expect(result.accessToken).toBe('new-access');
            expect(result.refreshToken).toBe('new-refresh');
        });

        it('throws on error response', async () => {
            const mockFetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 401,
                text: () => Promise.resolve('invalid_token'),
            });

            await expect(refreshTokens('bad-token', mockFetch)).rejects.toThrow(
                'Token refresh failed: 401'
            );
        });
    });

    describe('extractUserId', () => {
        it('extracts sub from valid JWT', () => {
            // Create a fake JWT with sub claim
            const payload = { sub: 'user-123', email: 'test@example.com' };
            const fakeJwt = `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

            const userId = extractUserId(fakeJwt);
            expect(userId).toBe('user-123');
        });

        it('returns null for invalid JWT', () => {
            expect(extractUserId('not-a-jwt')).toBeNull();
            expect(extractUserId('')).toBeNull();
        });

        it('returns null for JWT without sub', () => {
            const payload = { email: 'test@example.com' };
            const fakeJwt = `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

            expect(extractUserId(fakeJwt)).toBeNull();
        });
    });

    describe('isTokenExpired', () => {
        it('returns false for future expiration', () => {
            const expiresAt = Date.now() + 3600000; // 1 hour from now
            expect(isTokenExpired(expiresAt)).toBe(false);
        });

        it('returns true for past expiration', () => {
            const expiresAt = Date.now() - 1000;
            expect(isTokenExpired(expiresAt)).toBe(true);
        });

        it('returns true within buffer period', () => {
            const expiresAt = Date.now() + 60000; // 1 minute from now
            // Default buffer is 5 minutes
            expect(isTokenExpired(expiresAt)).toBe(true);
        });

        it('respects custom buffer', () => {
            const expiresAt = Date.now() + 60000; // 1 minute from now
            expect(isTokenExpired(expiresAt, 30000)).toBe(false); // 30 sec buffer
            expect(isTokenExpired(expiresAt, 120000)).toBe(true); // 2 min buffer
        });
    });
});
