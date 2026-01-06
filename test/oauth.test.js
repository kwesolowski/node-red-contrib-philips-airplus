/**
 * Tests for OAuth module.
 * Note: Most OAuth functions require network access to OIDC issuer.
 * These tests focus on pure functions that don't need network.
 */

const { generatePkce, parseRedirectUrl, extractUserId, isTokenExpired } = require('../lib/oauth');

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

        it('handles query string without URL prefix', () => {
            const input = 'code=st2.abc123.sc3&state=xyz';
            const { code, state } = parseRedirectUrl(input);
            expect(code).toBe('st2.abc123.sc3');
            expect(state).toBe('xyz');
        });

        it('throws on OAuth error response', () => {
            const input = 'com.philips.air://loginredirect?error=access_denied&error_description=User%20cancelled';
            expect(() => parseRedirectUrl(input)).toThrow('OAuth error');
        });
    });

    describe('extractUserId', () => {
        it('extracts sub from tokenSet with claims method', () => {
            const mockTokenSet = {
                claims: () => ({ sub: 'PHILIPS:user-123' }),
                access_token: 'dummy',
            };
            const userId = extractUserId(mockTokenSet);
            expect(userId).toBe('PHILIPS:user-123');
        });

        it('extracts sub from JWT access_token fallback', () => {
            // Create a fake JWT with sub claim
            const payload = { sub: 'PHILIPS:user-456' };
            const fakeJwt = `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

            const mockTokenSet = {
                access_token: fakeJwt,
            };
            const userId = extractUserId(mockTokenSet);
            expect(userId).toBe('PHILIPS:user-456');
        });

        it('returns null for invalid tokenSet', () => {
            expect(extractUserId({})).toBeNull();
            expect(extractUserId({ access_token: 'invalid' })).toBeNull();
        });
    });

    describe('isTokenExpired', () => {
        it('returns false for tokenSet with future expiration', () => {
            const tokenSet = {
                expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
            };
            expect(isTokenExpired(tokenSet)).toBe(false);
        });

        it('returns true for tokenSet with past expiration', () => {
            const tokenSet = {
                expires_at: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
            };
            expect(isTokenExpired(tokenSet)).toBe(true);
        });

        it('returns true within buffer period', () => {
            const tokenSet = {
                expires_at: Math.floor(Date.now() / 1000) + 60, // 1 minute from now
            };
            // Default buffer is 5 minutes (300000ms)
            expect(isTokenExpired(tokenSet)).toBe(true);
        });

        it('respects custom buffer', () => {
            const tokenSet = {
                expires_at: Math.floor(Date.now() / 1000) + 60, // 1 minute from now
            };
            expect(isTokenExpired(tokenSet, 30000)).toBe(false); // 30 sec buffer
            expect(isTokenExpired(tokenSet, 120000)).toBe(true); // 2 min buffer
        });

        it('returns false if expires_at not set', () => {
            expect(isTokenExpired({})).toBe(false);
        });
    });
});
