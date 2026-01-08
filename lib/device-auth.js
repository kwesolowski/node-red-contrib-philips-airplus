/**
 * Device Code Flow (RFC 8628) for Philips Air+ OAuth.
 * Allows authentication on headless devices like Raspberry Pi.
 */

const {
    OIDC_DEVICE_AUTH_ENDPOINT,
    OIDC_TOKEN_ENDPOINT,
    OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET,
    OIDC_SCOPES,
} = require('./constants');

/**
 * Request a device code from the authorization server.
 * @returns {Promise<{
 *   device_code: string,
 *   user_code: string,
 *   verification_uri: string,
 *   verification_uri_complete: string,
 *   expires_in: number,
 *   interval: number
 * }>}
 */
async function requestDeviceCode() {
    const params = new URLSearchParams({
        client_id: OIDC_CLIENT_ID,
        scope: OIDC_SCOPES,
    });

    const response = await fetch(OIDC_DEVICE_AUTH_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Device authorization failed: ${response.status} - ${text}`);
    }

    return response.json();
}

/**
 * Poll error types from RFC 8628.
 */
const PollError = {
    AUTHORIZATION_PENDING: 'authorization_pending',
    SLOW_DOWN: 'slow_down',
    ACCESS_DENIED: 'access_denied',
    EXPIRED_TOKEN: 'expired_token',
};

/**
 * Poll the token endpoint once.
 * @param {string} deviceCode - The device code from requestDeviceCode()
 * @returns {Promise<{status: 'pending'|'slow_down'|'success'|'error', tokens?: object, error?: string}>}
 */
async function pollTokenOnce(deviceCode) {
    const params = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: OIDC_CLIENT_ID,
        client_secret: OIDC_CLIENT_SECRET,
    });

    const response = await fetch(OIDC_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
    });

    const data = await response.json();

    if (response.ok) {
        return { status: 'success', tokens: data };
    }

    // Handle RFC 8628 error codes
    switch (data.error) {
        case PollError.AUTHORIZATION_PENDING:
            return { status: 'pending' };
        case PollError.SLOW_DOWN:
            return { status: 'slow_down' };
        case PollError.ACCESS_DENIED:
            return { status: 'error', error: 'User denied access' };
        case PollError.EXPIRED_TOKEN:
            return { status: 'error', error: 'Device code expired' };
        default:
            return { status: 'error', error: data.error_description || data.error || 'Unknown error' };
    }
}

/**
 * Poll the token endpoint until success or failure.
 * @param {string} deviceCode - The device code from requestDeviceCode()
 * @param {number} interval - Initial polling interval in seconds
 * @param {number} expiresIn - Time until device code expires in seconds
 * @param {function} [onPoll] - Optional callback called on each poll attempt
 * @returns {Promise<object>} - Token set on success
 */
async function pollForToken(deviceCode, interval, expiresIn, onPoll) {
    const startTime = Date.now();
    const expiresAtMs = startTime + expiresIn * 1000;
    let currentInterval = interval * 1000;

    while (Date.now() < expiresAtMs) {
        await sleep(currentInterval);

        if (onPoll) {
            onPoll({ elapsed: Math.floor((Date.now() - startTime) / 1000), interval: currentInterval / 1000 });
        }

        const result = await pollTokenOnce(deviceCode);

        switch (result.status) {
            case 'success':
                return result.tokens;
            case 'pending':
                // Continue polling
                break;
            case 'slow_down':
                // Increase interval by 5 seconds as per RFC 8628
                currentInterval += 5000;
                break;
            case 'error':
                throw new Error(result.error);
        }
    }

    throw new Error('Device code expired');
}

/**
 * Extract user ID from token set.
 * @param {object} tokenSet - Token set from pollForToken()
 * @returns {string|null}
 */
function extractUserId(tokenSet) {
    try {
        const token = tokenSet.access_token || tokenSet.id_token;
        if (!token) return null;

        const parts = token.split('.');
        if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
            return payload.sub || null;
        }
    } catch {
        // Ignore decode errors
    }
    return null;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
    requestDeviceCode,
    pollTokenOnce,
    pollForToken,
    extractUserId,
    PollError,
};
