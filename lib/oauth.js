/**
 * OAuth PKCE authentication for Philips Air+ cloud using openid-client.
 * Handles the Philips home.id OIDC flow.
 */

const { Issuer, generators } = require('openid-client');
const {
  OIDC_ISSUER,
  OIDC_REDIRECT_URI,
  OIDC_CLIENT_ID,
  OIDC_CLIENT_SECRET,
  OIDC_SCOPES,
} = require('./constants');

let cachedIssuer = null;
let cachedClient = null;

/**
 * Get or create the OIDC issuer (cached).
 * @returns {Promise<Issuer>}
 */
async function getIssuer() {
  if (cachedIssuer) return cachedIssuer;

  // Philips home.id uses standard OIDC discovery
  cachedIssuer = await Issuer.discover(OIDC_ISSUER);
  return cachedIssuer;
}

/**
 * Get or create the OIDC client (cached).
 * @returns {Promise<Client>}
 */
async function getClient() {
  if (cachedClient) return cachedClient;

  const issuer = await getIssuer();
  cachedClient = new issuer.Client({
    client_id: OIDC_CLIENT_ID,
    client_secret: OIDC_CLIENT_SECRET,
    redirect_uris: [OIDC_REDIRECT_URI],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
  });
  return cachedClient;
}

/**
 * Generate PKCE code verifier and challenge.
 * @returns {{ verifier: string, challenge: string }}
 */
function generatePkce() {
  const verifier = generators.codeVerifier();
  const challenge = generators.codeChallenge(verifier);
  return { verifier, challenge };
}

/**
 * Generate state parameter for CSRF protection.
 * @returns {string}
 */
function generateState() {
  return generators.state();
}

/**
 * Generate nonce for ID token validation.
 * @returns {string}
 */
function generateNonce() {
  return generators.nonce();
}

/**
 * Build OAuth authorization URL with PKCE.
 * @param {object} params
 * @param {string} params.codeChallenge - PKCE challenge
 * @param {string} params.state - State parameter
 * @param {string} [params.nonce] - Optional nonce
 * @returns {Promise<string>} Authorization URL
 */
async function buildAuthUrl({ codeChallenge, state, nonce }) {
  const client = await getClient();

  const params = {
    scope: OIDC_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    response_mode: 'query',
    ui_locales: 'en-US',
  };

  if (nonce) {
    params.nonce = nonce;
  }

  return client.authorizationUrl(params);
}

/**
 * Parse redirect URL to extract authorization code and state.
 * @param {string} redirectUrl - The full redirect URL or just query params
 * @returns {{ code: string, state: string | null }}
 */
function parseRedirectUrl(redirectUrl) {
  const raw = redirectUrl.trim().replace(/^["']|["']$/g, '');

  // Find query string
  let queryString;
  if (raw.includes('?')) {
    queryString = raw.split('?')[1];
  } else if (raw.includes('&') || raw.includes('=')) {
    queryString = raw;
  } else {
    // Assume it's just the code
    return { code: raw, state: null };
  }

  const params = new URLSearchParams(queryString);
  const code = params.get('code');
  const state = params.get('state');

  if (!code) {
    const error = params.get('error');
    const errorDesc = params.get('error_description');
    throw new Error(`OAuth error: ${error || 'code missing'} - ${errorDesc || ''}`);
  }

  return { code, state };
}

/**
 * Exchange authorization code for tokens.
 * @param {object} params
 * @param {string} params.code - Authorization code
 * @param {string} params.codeVerifier - PKCE verifier
 * @param {string} [params.nonce] - Nonce for ID token validation (optional)
 * @returns {Promise<TokenSet>}
 */
async function exchangeCode({ code, codeVerifier, nonce }) {
  const client = await getClient();

  const tokenSet = await client.callback(
    OIDC_REDIRECT_URI,
    { code },
    {
      code_verifier: codeVerifier,
      nonce,
    }
  );

  return tokenSet;
}

/**
 * Refresh tokens using refresh token.
 * @param {string} refreshToken - Refresh token
 * @returns {Promise<TokenSet>}
 */
async function refreshTokens(refreshToken) {
  const client = await getClient();
  return client.refresh(refreshToken);
}

/**
 * Extract user ID from token set.
 * The user ID format is "PHILIPS:uuid" from the 'sub' claim.
 * @param {TokenSet} tokenSet - Token set from openid-client
 * @returns {string | null}
 */
function extractUserId(tokenSet) {
  if (tokenSet.claims && typeof tokenSet.claims === 'function') {
    const claims = tokenSet.claims();
    return claims.sub || null;
  }
  // Fallback: decode access token manually
  try {
    const parts = tokenSet.access_token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      return payload.sub || null;
    }
  } catch {
    // Ignore decode errors
  }
  return null;
}

/**
 * Check if token is expired or about to expire.
 * @param {TokenSet} tokenSet - Token set
 * @param {number} [bufferMs=300000] - Buffer before expiration (default 5 min)
 * @returns {boolean}
 */
function isTokenExpired(tokenSet, bufferMs = 300000) {
  if (!tokenSet.expires_at) return false;
  const expiresAtMs = tokenSet.expires_at * 1000;
  return Date.now() >= expiresAtMs - bufferMs;
}

/**
 * Clear cached issuer and client (useful for testing).
 */
function clearCache() {
  cachedIssuer = null;
  cachedClient = null;
}

module.exports = {
  getIssuer,
  getClient,
  generatePkce,
  generateState,
  generateNonce,
  buildAuthUrl,
  parseRedirectUrl,
  exchangeCode,
  refreshTokens,
  extractUserId,
  isTokenExpired,
  clearCache,
};
