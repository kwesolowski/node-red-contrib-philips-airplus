#!/usr/bin/env node
/**
 * CLI tool for Philips Air+ OAuth authentication.
 * Uses Playwright to automate browser login and intercept the OAuth redirect.
 */

const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// OAuth constants (same as lib/constants.js)
const OIDC_ISSUER = 'https://cdc.accounts.home.id/oidc/op/v1.0/4_JGZWlP8eQHpEqkvQElolbA';
const OIDC_REDIRECT_URI = 'com.philips.air://loginredirect';
const OIDC_CLIENT_ID = '-XsK7O6iEkLml77yDGDUi0ku';
const OIDC_CLIENT_SECRET = 'V34BlAhuilIdOx0Imo16rGQ2';
const OIDC_SCOPES = [
    'openid',
    'email',
    'profile',
    'address',
    'DI.Account.read',
    'DI.Account.write',
    'DI.AccountProfile.read',
    'DI.AccountProfile.write',
    'DI.AccountGeneralConsent.read',
    'DI.AccountGeneralConsent.write',
    'DI.GeneralConsent.read',
    'subscriptions',
    'profile_extended',
    'consents',
    'DI.AccountSubscription.read',
    'DI.AccountSubscription.write',
].join(' ');

// Credentials file location
const CREDENTIALS_DIR = path.join(os.homedir(), '.philips-airplus');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');

/**
 * Generate PKCE code verifier and challenge.
 */
function generatePkce() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}

/**
 * Build OAuth authorization URL.
 */
async function buildAuthUrl(codeChallenge, state) {
    // Discover OIDC endpoints
    const discoveryUrl = `${OIDC_ISSUER}/.well-known/openid-configuration`;
    const response = await fetch(discoveryUrl);
    const config = await response.json();

    const params = new URLSearchParams({
        client_id: OIDC_CLIENT_ID,
        redirect_uri: OIDC_REDIRECT_URI,
        response_type: 'code',
        scope: OIDC_SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        response_mode: 'query',
        ui_locales: 'en-US',
    });

    return `${config.authorization_endpoint}?${params}`;
}

/**
 * Exchange authorization code for tokens.
 */
async function exchangeCode(code, codeVerifier) {
    // Discover OIDC endpoints
    const discoveryUrl = `${OIDC_ISSUER}/.well-known/openid-configuration`;
    const response = await fetch(discoveryUrl);
    const config = await response.json();

    const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: OIDC_REDIRECT_URI,
        client_id: OIDC_CLIENT_ID,
        client_secret: OIDC_CLIENT_SECRET,
        code_verifier: codeVerifier,
    });

    const tokenResponse = await fetch(config.token_endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
    });

    if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        throw new Error(`Token exchange failed: ${tokenResponse.status} - ${error}`);
    }

    return tokenResponse.json();
}

/**
 * Extract user ID from token.
 */
function extractUserId(tokenSet) {
    try {
        const parts = tokenSet.access_token.split('.');
        if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
            return payload.sub || null;
        }
    } catch {
        // Try id_token
        if (tokenSet.id_token) {
            try {
                const parts = tokenSet.id_token.split('.');
                if (parts.length === 3) {
                    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
                    return payload.sub || null;
                }
            } catch {
                // Ignore
            }
        }
    }
    return null;
}

/**
 * Save credentials to file.
 */
function saveCredentials(credentials) {
    if (!fs.existsSync(CREDENTIALS_DIR)) {
        fs.mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

/**
 * Load existing credentials.
 */
function loadCredentials() {
    try {
        if (fs.existsSync(CREDENTIALS_FILE)) {
            return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
        }
    } catch {
        // Ignore
    }
    return null;
}

/**
 * Main authentication flow.
 */
async function authenticate() {
    console.log('Philips Air+ Authentication\n');

    // Check for existing credentials
    const existing = loadCredentials();
    if (existing && existing.refresh_token) {
        console.log('Found existing credentials.');
        console.log(`User ID: ${existing.user_id}`);
        console.log(`Expires: ${new Date(existing.expires_at * 1000).toLocaleString()}`);
        console.log('\nTo re-authenticate, delete:', CREDENTIALS_FILE);
        console.log('');
        return;
    }

    // Generate PKCE
    const { verifier, challenge } = generatePkce();
    const state = crypto.randomBytes(16).toString('base64url');

    // Build auth URL
    console.log('Building authorization URL...');
    const authUrl = await buildAuthUrl(challenge, state);

    console.log('\nOpening browser for login...');
    console.log('Please log in to your Philips account.\n');

    // Launch browser
    const browser = await chromium.launch({
        headless: false,
        args: ['--disable-blink-features=AutomationControlled'],
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    let authCode = null;
    let receivedState = null;

    // Intercept redirect to custom scheme
    page.on('response', async (response) => {
        // Check for redirect to our custom scheme
        const status = response.status();
        if (status >= 300 && status < 400) {
            const location = response.headers()['location'];
            if (location && location.startsWith(OIDC_REDIRECT_URI)) {
                console.log('Intercepted OAuth redirect!');
                const url = new URL(location);
                authCode = url.searchParams.get('code');
                receivedState = url.searchParams.get('state');
            }
        }
    });

    // Also listen for request to custom scheme (fallback)
    page.on('request', (request) => {
        const url = request.url();
        if (url.startsWith(OIDC_REDIRECT_URI)) {
            console.log('Intercepted redirect request!');
            const parsedUrl = new URL(url);
            authCode = parsedUrl.searchParams.get('code');
            receivedState = parsedUrl.searchParams.get('state');
        }
    });

    try {
        // Navigate to auth URL
        await page.goto(authUrl);

        // Wait for auth code (with timeout)
        const startTime = Date.now();
        const timeout = 5 * 60 * 1000; // 5 minutes

        while (!authCode && Date.now() - startTime < timeout) {
            await page.waitForTimeout(500);

            // Check if we're on a page that failed to load (custom scheme)
            try {
                const currentUrl = page.url();
                if (currentUrl.startsWith(OIDC_REDIRECT_URI)) {
                    const parsedUrl = new URL(currentUrl);
                    authCode = parsedUrl.searchParams.get('code');
                    receivedState = parsedUrl.searchParams.get('state');
                    break;
                }
            } catch {
                // Ignore URL parsing errors
            }
        }

        if (!authCode) {
            throw new Error('Authentication timed out. Please try again.');
        }

        // Verify state
        if (receivedState !== state) {
            console.warn('Warning: State mismatch. Proceeding anyway...');
        }

        console.log('Got authorization code!');

    } finally {
        await browser.close();
    }

    // Exchange code for tokens
    console.log('\nExchanging code for tokens...');
    const tokenSet = await exchangeCode(authCode, verifier);

    // Extract user ID
    const userId = extractUserId(tokenSet);
    console.log(`User ID: ${userId}`);

    // Save credentials
    const credentials = {
        user_id: userId,
        refresh_token: tokenSet.refresh_token,
        access_token: tokenSet.access_token,
        expires_at: tokenSet.expires_at || Math.floor(Date.now() / 1000) + tokenSet.expires_in,
        saved_at: new Date().toISOString(),
    };

    saveCredentials(credentials);

    console.log(`\nCredentials saved to: ${CREDENTIALS_FILE}`);
    console.log('\nYou can now use the Philips Air+ nodes in Node-RED.');
    console.log('The nodes will automatically read credentials from this file.');
}

// Run
authenticate().catch((err) => {
    console.error('\nError:', err.message);
    process.exit(1);
});
