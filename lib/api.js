/**
 * REST API client for Philips Air+ cloud.
 * Pure functions with dependency injection for testing.
 */

const {
    API_DEVICE_ENDPOINT,
    API_SIGNATURE_ENDPOINT,
    API_USER_ENDPOINT,
    API_GET_ID_ENDPOINT,
} = require('./constants');

/**
 * Create an API client instance.
 * @param {object} options
 * @param {function} options.getToken - Async function that returns current access token
 * @param {function} [options.fetchFn] - Optional fetch implementation (for testing)
 * @returns {object} API client
 */
function createApiClient({ getToken, fetchFn = fetch }) {
    async function request(url, options = {}) {
        const token = await getToken();
        const headers = {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'User-Agent': 'node-red-contrib-philips-airplus/0.1.0',
            ...options.headers,
        };

        const response = await fetchFn(url, { ...options, headers });

        if (!response.ok) {
            const text = await response.text();
            const error = new Error(`API error: ${response.status} - ${text}`);
            error.status = response.status;
            throw error;
        }

        return response.json();
    }

    return {
        /**
         * List all devices associated with the account.
         * @returns {Promise<Array<{ id: string, name: string, model: string }>>}
         */
        async listDevices() {
            const data = await request(API_DEVICE_ENDPOINT);
            return parseDeviceList(data);
        },

        /**
         * Get MQTT signature for authentication.
         * @returns {Promise<{ signature: string, authorizerName: string }>}
         */
        async getSignature() {
            const data = await request(API_SIGNATURE_ENDPOINT);
            if (!data.signature) {
                throw new Error('Signature missing in response');
            }
            return {
                signature: data.signature,
                authorizerName: data.authorizerName || 'CustomAuthorizer',
            };
        },

        /**
         * Get user information.
         * @returns {Promise<object>}
         */
        async getUserInfo() {
            return request(API_USER_ENDPOINT);
        },

        /**
         * Register user with Philips IoT platform using id_token.
         * This must be called before listDevices() will work.
         * @param {string} idToken - The id_token from OAuth response
         * @returns {Promise<{ userId: string }>}
         */
        async registerUser(idToken) {
            const token = await getToken();
            const response = await fetchFn(API_GET_ID_ENDPOINT, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'node-red-contrib-philips-airplus/0.1.0',
                },
                body: JSON.stringify({ idToken }),
            });

            if (!response.ok) {
                const text = await response.text();
                const error = new Error(`Register user failed: ${response.status} - ${text}`);
                error.status = response.status;
                throw error;
            }

            return response.json();
        },
    };
}

/**
 * Parse device list response into normalized format.
 * Handles various response structures from the API.
 * @param {object} data - Raw API response
 * @returns {Array<{ id: string, name: string, model: string, type: string }>}
 */
function parseDeviceList(data) {
    let devices = [];

    if (Array.isArray(data)) {
        devices = data;
    } else if (data && typeof data === 'object') {
        // Check for devices array in response
        if (Array.isArray(data.devices)) {
            devices = data.devices;
        } else {
            // Fallback: find any array with uuid entries
            for (const value of Object.values(data)) {
                if (
                    Array.isArray(value) &&
                    value.some((item) => item && typeof item === 'object' && item.uuid)
                ) {
                    devices = value;
                    break;
                }
            }
        }
    }

    return devices.map((d) => ({
        id: normalizeDeviceId(d.uuid || d.id || 'unknown'),
        name: d.name || d.productName || d.modelId || 'Unknown Device',
        model: d.modelId || d.productName || '',
        type: d.type || d.deviceType || '',
        raw: d,
    }));
}

/**
 * Normalize device ID to include 'da-' prefix if missing.
 * @param {string} id - Raw device ID
 * @returns {string} Normalized device ID
 */
function normalizeDeviceId(id) {
    if (!id) return 'unknown';
    // If it's a 32-char hex string, convert to UUID format with da- prefix
    if (/^[a-f0-9]{32}$/i.test(id)) {
        const uuid = [
            id.slice(0, 8),
            id.slice(8, 12),
            id.slice(12, 16),
            id.slice(16, 20),
            id.slice(20),
        ].join('-');
        return `da-${uuid}`;
    }
    // If already has da- prefix, return as-is
    if (id.startsWith('da-')) {
        return id;
    }
    // Otherwise add da- prefix
    return `da-${id}`;
}

module.exports = {
    createApiClient,
    parseDeviceList,
    normalizeDeviceId,
};
