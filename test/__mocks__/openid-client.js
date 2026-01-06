/**
 * Mock for openid-client library.
 * Provides the generators functions used by our code.
 */

const crypto = require('crypto');

const generators = {
    codeVerifier: () => crypto.randomBytes(32).toString('base64url'),
    codeChallenge: (verifier) =>
        crypto.createHash('sha256').update(verifier).digest('base64url'),
    state: () => crypto.randomBytes(16).toString('base64url'),
    nonce: () => crypto.randomBytes(16).toString('base64url'),
};

class MockClient {
    constructor(config) {
        this.config = config;
    }

    authorizationUrl(params) {
        const url = new URL('https://cdc.accounts.home.id/oidc/op/v1.0/authorize');
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }
        url.searchParams.set('client_id', this.config.client_id);
        url.searchParams.set('redirect_uri', this.config.redirect_uris[0]);
        url.searchParams.set('response_type', 'code');
        return url.toString();
    }

    async callback(redirectUri, params, checks) {
        // Mock token exchange
        return {
            access_token: 'mock-access-token',
            refresh_token: 'mock-refresh-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            claims: () => ({ sub: 'PHILIPS:mock-user-id' }),
        };
    }

    async refresh(refreshToken) {
        return {
            access_token: 'mock-refreshed-token',
            refresh_token: 'mock-new-refresh-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            claims: () => ({ sub: 'PHILIPS:mock-user-id' }),
        };
    }
}

class Issuer {
    constructor(metadata) {
        this.metadata = metadata;
    }

    Client(config) {
        return new MockClient(config);
    }

    static async discover(issuerUrl) {
        return new Issuer({
            issuer: issuerUrl,
            authorization_endpoint: `${issuerUrl}/authorize`,
            token_endpoint: `${issuerUrl}/token`,
        });
    }
}

module.exports = {
    Issuer,
    generators,
};
