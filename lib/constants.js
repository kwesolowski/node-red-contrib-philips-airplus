/**
 * Philips Air+ cloud API constants.
 * Based on reverse-engineered protocol from philips-airplus-homeassistant.
 */

// OAuth / OIDC configuration
const OIDC_ISSUER_BASE = 'https://cdc.accounts.home.id/oidc/op/v1.0';
const OIDC_TENANT = '4_JGZWlP8eQHpEqkvQElolbA';
const OIDC_AUTHORIZE_URL = `${OIDC_ISSUER_BASE}/${OIDC_TENANT}/authorize`;
const OIDC_TOKEN_URL = `${OIDC_ISSUER_BASE}/${OIDC_TENANT}/token`;
const OIDC_REDIRECT_URI = 'com.philips.air://loginredirect';
const OIDC_CLIENT_ID = '-XsK7O6iEkLml77yDGDUi0ku';
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

// REST API configuration
const API_HOST = 'prod.eu-da.iot.versuni.com';
const API_BASE_URL = `https://${API_HOST}/api/da/user/self`;
const API_DEVICE_ENDPOINT = `${API_BASE_URL}/device`;
const API_SIGNATURE_ENDPOINT = `${API_BASE_URL}/signature`;
const API_USER_ENDPOINT = API_BASE_URL;
const API_GET_ID_ENDPOINT = `${API_BASE_URL}/get-id`;

// MQTT configuration
const MQTT_HOST = 'ats.prod.eu-da.iot.versuni.com';
const MQTT_PORT = 443;
const MQTT_PATH = '/mqtt';
const MQTT_KEEPALIVE_SEC = 4;
const MQTT_CUSTOM_AUTHORIZER = 'CustomAuthorizer';

// MQTT topics
const TOPIC_CONTROL = 'da_ctrl/{deviceId}/to_ncp';
const TOPIC_STATUS = 'da_ctrl/{deviceId}/from_ncp';
const TOPIC_SHADOW_UPDATE = '$aws/things/{deviceId}/shadow/update';
const TOPIC_SHADOW_GET = '$aws/things/{deviceId}/shadow/get';

// Device ports (for MQTT messages)
const PORT_STATUS = 'Status';
const PORT_CONTROL = 'Control';
const PORT_CONFIG = 'Config';
const PORT_FILTER_READ = 'filtRd';

// Fan speed range
const FAN_SPEED_MIN = 1;
const FAN_SPEED_MAX = 18;

// Operating modes
const MODES = {
    AUTO: 'A',
    SLEEP: 'S',
    TURBO: 'T',
    MANUAL: 'M',
};

const MODE_NAMES = {
    A: 'auto',
    S: 'sleep',
    T: 'turbo',
    M: 'manual',
};

// Token refresh buffer (refresh 5 min before expiry)
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Reconnection settings
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 300000;

module.exports = {
    // OAuth
    OIDC_AUTHORIZE_URL,
    OIDC_TOKEN_URL,
    OIDC_REDIRECT_URI,
    OIDC_CLIENT_ID,
    OIDC_SCOPES,

    // API
    API_BASE_URL,
    API_DEVICE_ENDPOINT,
    API_SIGNATURE_ENDPOINT,
    API_USER_ENDPOINT,
    API_GET_ID_ENDPOINT,

    // MQTT
    MQTT_HOST,
    MQTT_PORT,
    MQTT_PATH,
    MQTT_KEEPALIVE_SEC,
    MQTT_CUSTOM_AUTHORIZER,

    // Topics
    TOPIC_CONTROL,
    TOPIC_STATUS,
    TOPIC_SHADOW_UPDATE,
    TOPIC_SHADOW_GET,

    // Ports
    PORT_STATUS,
    PORT_CONTROL,
    PORT_CONFIG,
    PORT_FILTER_READ,

    // Fan
    FAN_SPEED_MIN,
    FAN_SPEED_MAX,

    // Modes
    MODES,
    MODE_NAMES,

    // Timing
    TOKEN_REFRESH_BUFFER_MS,
    RECONNECT_BASE_MS,
    RECONNECT_MAX_MS,
};
