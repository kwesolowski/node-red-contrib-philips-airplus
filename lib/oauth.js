/**
 * OAuth PKCE authentication for Philips Air+ cloud.
 * Pure functions - no Node-RED dependencies.
 */

const crypto = require('crypto');
const {
    OIDC_AUTHORIZE_URL,
    OIDC_TOKEN_URL,
    OIDC_REDIRECT_URI,
    OIDC_CLIENT_ID,
    OIDC_SCOPES,
} = require('./constants');

/**
 * Generate PKCE verifier and challenge.
 * @returns {{ verifier: string, challenge: string }}
 */
function generatePkce() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');
    return { verifier, challenge };
}

/**
 * Build OAuth authorization URL.
 * @param {string} challenge - PKCE challenge
 * @param {string} state - State parameter (use node ID for correlation)
 * @returns {string} Authorization URL
 */
function buildAuthUrl(challenge, state) {
    const params = new URLSearchParams({
        client_id: OIDC_CLIENT_ID,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        response_type: 'code',
        response_mode: 'query',
        redirect_uri: OIDC_REDIRECT_URI,
        ui_locales: 'en-US',
        state: state,
        nonce: crypto.randomBytes(16).toString('base64url'),
        scope: OIDC_SCOPES,
    });
    return `${OIDC_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Parse redirect URL to extract authorization code.
 * Handles various formats:
 * - Full URL: com.philips.air://loginredirect?code=xxx&state=yyy
 * - Just the code: st2.xxx.sc3
 * - URL with extra params
 * @param {string} input - User-provided redirect URL or code
 * @returns {{ code: string, state: string | null }}
 */
function parseRedirectUrl(input) {
    const raw = input.trim().replace(/^["']|["']$/g, '');

    // If it looks like a URL, parse it
    if (raw.includes('://') || raw.includes('?')) {
        const queryStart = raw.indexOf('?');
        if (queryStart === -1) {
            throw new Error('Invalid redirect URL: no query parameters');
        }
        const queryString = raw.slice(queryStart + 1);
        const params = new URLSearchParams(queryString);
        const code = params.get('code');
        const state = params.get('state');
        if (!code) {
            throw new Error('Invalid redirect URL: code parameter missing');
        }
        return { code, state };
    }

    // Otherwise treat as bare code
    // Remove any trailing &state=xxx if accidentally included
    const code = raw.split('&')[0];
    return { code, state: null };
}

/**
 * Exchange authorization code for tokens.
 * @param {string} code - Authorization code
 * @param {string} verifier - PKCE verifier
 * @param {function} [fetchFn] - Optional fetch implementation (for testing)
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresAt: number }>}
 */
async function exchangeCode(code, verifier, fetchFn = fetch) {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: OIDC_REDIRECT_URI,
        client_id: OIDC_CLIENT_ID,
        code_verifier: verifier,
    });

    const response = await fetchFn(OIDC_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Token exchange failed: ${response.status} - ${text}`);
    }

    const data = await response.json();
    return parseTokenResponse(data);
}

/**
 * Refresh access token using refresh token.
 * @param {string} refreshToken - Refresh token
 * @param {function} [fetchFn] - Optional fetch implementation (for testing)
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresAt: number }>}
 */
async function refreshTokens(refreshToken, fetchFn = fetch) {
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: OIDC_CLIENT_ID,
    });

    const response = await fetchFn(OIDC_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Token refresh failed: ${response.status} - ${text}`);
    }

    const data = await response.json();
    return parseTokenResponse(data);
}

/**
 * Parse token response into normalized format.
 * @param {object} data - Raw token response
 * @returns {{ accessToken: string, refreshToken: string, idToken: string|null, expiresAt: number }}
 */
function parseTokenResponse(data) {
    const accessToken = data.access_token;
    const refreshToken = data.refresh_token;
    const idToken = data.id_token || null;
    const expiresIn = data.expires_in || 3600;
    const expiresAt = Date.now() + expiresIn * 1000;

    if (!accessToken) {
        throw new Error('Token response missing access_token');
    }

    return { accessToken, refreshToken, idToken, expiresAt };
}

/**
 * Extract user ID from JWT access token.
 * @param {string} accessToken - JWT access token
 * @returns {string | null} User ID (sub claim)
 */
function extractUserId(accessToken) {
    try {
        const parts = accessToken.split('.');
        if (parts.length !== 3) return null;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        return payload.sub || null;
    } catch {
        return null;
    }
}

/**
 * Check if token is expired or about to expire.
 * @param {number} expiresAt - Token expiration timestamp
 * @param {number} [bufferMs=300000] - Buffer before expiration (default 5 min)
 * @returns {boolean}
 */
function isTokenExpired(expiresAt, bufferMs = 300000) {
    return Date.now() >= expiresAt - bufferMs;
}

module.exports = {
    generatePkce,
    buildAuthUrl,
    parseRedirectUrl,
    exchangeCode,
    refreshTokens,
    extractUserId,
    isTokenExpired,
};
