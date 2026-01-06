/**
 * MxChip/FogCloud API client for Philips Air+ cloud.
 * Handles device list and MQTT credential retrieval.
 */

const crypto = require('crypto');
const {
    MXCHIP_SERVER_TIME,
    MXCHIP_GET_TOKEN,
    MXCHIP_DEVICE_LIST,
    MXCHIP_MQTT_INFO,
    MXCHIP_APP_ID,
    MXCHIP_HMAC_SECRET,
    MXCHIP_USER_AGENT,
} = require('./constants');

/**
 * Generate MxChip API signature.
 * Double HMAC-SHA256: first with secret, then with username.
 * @param {string} appId - MxChip app ID
 * @param {string} timestamp - Server timestamp as string
 * @param {string} username - User ID (PHILIPS:uuid format)
 * @returns {string} Hex signature
 */
function generateSignature(appId, timestamp, username) {
    // URL-encode username for params string
    const usernameEncoded = encodeURIComponent(username);

    // Build params string (alphabetically sorted keys)
    const params = `app_id=${appId}&timestamp=${timestamp}&username=${usernameEncoded}`;

    // First HMAC: params with secret
    const hmac1 = crypto
        .createHmac('sha256', MXCHIP_HMAC_SECRET)
        .update(params)
        .digest('hex');

    // Second HMAC: hmac1 with username as key
    const signature = crypto
        .createHmac('sha256', username)
        .update(hmac1)
        .digest('hex');

    return signature;
}

/**
 * Ensure user ID has PHILIPS: prefix required by MxChip API.
 * @param {string} userId - Raw or prefixed user ID
 * @returns {string} User ID with PHILIPS: prefix
 */
function ensurePhilipsPrefix(userId) {
    if (!userId) return userId;
    return userId.startsWith('PHILIPS:') ? userId : `PHILIPS:${userId}`;
}

/**
 * Create an API client for MxChip/FogCloud endpoints.
 * @param {object} options
 * @param {function} [options.fetchFn] - Optional fetch implementation (for testing)
 * @param {function} [options.log] - Optional logging function
 * @returns {object} API client
 */
function createApiClient({ fetchFn = fetch, log = console.log } = {}) {
    let mxchipToken = null;
    let tokenExpiry = 0;

    const headers = {
        'User-Agent': MXCHIP_USER_AGENT,
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
    };

    /**
     * Get server time from MxChip API.
     * @returns {Promise<{ timestamp: string }>}
     */
    async function getServerTime() {
        const response = await fetchFn(MXCHIP_SERVER_TIME, { headers });

        if (!response.ok) {
            throw new Error(`Server time failed: ${response.status}`);
        }

        const data = await response.json();
        if (data.meta?.code !== 0) {
            throw new Error(`Server time error: ${data.meta?.message}`);
        }

        return {
            timestamp: String(data.data.timestamp1),
        };
    }

    /**
     * Get MxChip JWT token using HMAC authentication.
     * @param {string} userId - Philips user ID (with or without PHILIPS: prefix)
     * @returns {Promise<string>} JWT token
     */
    async function getToken(userId) {
        const prefixedUserId = ensurePhilipsPrefix(userId);
        log(`[api] getToken for user: ${prefixedUserId}`);

        // Return cached token if still valid (with 5 min buffer)
        if (mxchipToken && Date.now() < tokenExpiry - 5 * 60 * 1000) {
            log('[api] Using cached token');
            return mxchipToken;
        }

        log('[api] Fetching server time...');
        const { timestamp } = await getServerTime();
        log(`[api] Server timestamp: ${timestamp}`);

        const signature = generateSignature(MXCHIP_APP_ID, timestamp, prefixedUserId);
        log(`[api] Generated signature: ${signature.substring(0, 16)}...`);

        log(`[api] POST ${MXCHIP_GET_TOKEN}`);
        const response = await fetchFn(MXCHIP_GET_TOKEN, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json; charset=utf-8',
                signature,
            },
            body: JSON.stringify({
                timestamp,
                username: prefixedUserId,
                app_id: MXCHIP_APP_ID,
            }),
        });

        if (!response.ok) {
            const text = await response.text();
            log(`[api] Token request failed: ${response.status} - ${text}`);
            throw new Error(`Get token failed: ${response.status} - ${text}`);
        }

        const data = await response.json();
        log(`[api] Token response code: ${data.meta?.code}`);

        if (data.meta?.code !== 0) {
            log(`[api] Token error: ${data.meta?.message}`);
            throw new Error(`Get token error: ${data.meta?.message}`);
        }

        mxchipToken = data.data.token;
        log('[api] Token received successfully');

        // Parse token expiry from JWT (exp claim)
        try {
            const payload = JSON.parse(
                Buffer.from(mxchipToken.split('.')[1], 'base64url').toString()
            );
            tokenExpiry = payload.exp * 1000;
            log(`[api] Token expires at: ${new Date(tokenExpiry).toISOString()}`);
        } catch {
            // Default to 7 days if parsing fails
            tokenExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
            log('[api] Could not parse token expiry, defaulting to 7 days');
        }

        return mxchipToken;
    }

    /**
     * Make authenticated request to MxChip API.
     * @param {string} url - API endpoint
     * @param {string} userId - Philips user ID
     * @param {object} [options] - Fetch options
     * @returns {Promise<object>} Response data
     */
    async function request(url, userId, options = {}) {
        const token = await getToken(userId);

        const response = await fetchFn(url, {
            ...options,
            headers: {
                ...headers,
                Authorization: `jwt ${token}`,
                ...options.headers,
            },
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`API error: ${response.status} - ${text}`);
        }

        const data = await response.json();
        if (data.meta?.code !== 0) {
            throw new Error(`API error: ${data.meta?.message}`);
        }

        return data.data;
    }

    return {
        getServerTime,
        getToken,

        /**
         * List all devices bound to user.
         * @param {string} userId - Philips user ID
         * @returns {Promise<Array>} Device list
         */
        async listDevices(userId) {
            log(`[api] listDevices for user: ${userId}`);
            log(`[api] GET ${MXCHIP_DEVICE_LIST}`);
            const data = await request(MXCHIP_DEVICE_LIST, userId);
            const devices = Array.isArray(data) ? data.map(parseDevice) : [];
            log(`[api] Found ${devices.length} device(s)`);
            devices.forEach((d) => log(`[api]   - ${d.id}: ${d.name} (${d.model})`));
            return devices;
        },

        /**
         * Get MQTT connection info for devices.
         * @param {string} userId - Philips user ID
         * @param {string[]} deviceIds - Device IDs to get MQTT info for
         * @returns {Promise<Array<MqttInfo>>}
         */
        async getMqttInfo(userId, deviceIds) {
            const data = await request(MXCHIP_MQTT_INFO, userId, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                },
                body: JSON.stringify({ device_id: deviceIds }),
            });

            return data.mqttinfos || [];
        },

        /**
         * Clear cached token (for testing or re-auth).
         */
        clearToken() {
            mxchipToken = null;
            tokenExpiry = 0;
        },
    };
}

/**
 * Parse device from API response into normalized format.
 * @param {object} raw - Raw device object from API
 * @returns {object} Normalized device
 */
function parseDevice(raw) {
    const info = raw.device_info || {};
    return {
        id: raw.device_id || info.device_id,
        name: info.name || info.device_alias || 'Unknown Device',
        model: info.modelid || '',
        type: info.type || '',
        mac: info.mac || '',
        isOnline: info.is_online || false,
        swVersion: info.swversion || '',
        serviceRegion: info.service_region || '',
        raw,
    };
}

module.exports = {
    createApiClient,
    generateSignature,
    ensurePhilipsPrefix,
    parseDevice,
};
