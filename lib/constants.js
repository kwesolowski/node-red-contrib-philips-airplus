/**
 * Philips Air+ cloud API constants.
 * Based on reverse-engineered protocol from Android app traffic capture.
 */

// OAuth / OIDC configuration (Philips home.id via SAP CDC / Gigya)
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

// MxChip / FogCloud API (main device API)
// Must use hostname for proper TLS/SNI - raw IPs (23.38.108.27/31) reject connections
const MXCHIP_API_HOST = 'www.api.air.philips.com';
const MXCHIP_API_BASE = `https://${MXCHIP_API_HOST}`;
const MXCHIP_APP_ID = '9fd505fa9c7111e9a1e3061302926720';
const MXCHIP_HMAC_SECRET = 'a_zagf9sb2dpbiImtycwibgfzd6nksd65m';
const MXCHIP_USER_AGENT = 'MxChip&Fog&Hyj#com.philips.ph.homecare#_v3.16.1';

// MxChip API endpoints
const MXCHIP_SERVER_TIME = `${MXCHIP_API_BASE}/device/serverTime/`;
const MXCHIP_GET_TOKEN = `${MXCHIP_API_BASE}/enduser/v2/getToken/`;
const MXCHIP_DEVICE_LIST = `${MXCHIP_API_BASE}/enduser/deviceList/`;
const MXCHIP_MQTT_INFO = `${MXCHIP_API_BASE}/enduser/v2/mqttInfo/`;
const MXCHIP_UPDATE_LANGUAGE = `${MXCHIP_API_BASE}/enduser/updateLanguage/`;

// AWS IoT Core configuration
const AWS_IOT_ENDPOINT = 'a2gv4wmvb0sdt5-ats.iot.eu-central-1.amazonaws.com';
const AWS_IOT_REGION = 'eu-central-1';

// AWS IoT Shadow topics
const TOPIC_SHADOW_GET = '$aws/things/{deviceId}/shadow/get';
const TOPIC_SHADOW_GET_ACCEPTED = '$aws/things/{deviceId}/shadow/get/accepted';
const TOPIC_SHADOW_GET_REJECTED = '$aws/things/{deviceId}/shadow/get/rejected';
const TOPIC_SHADOW_UPDATE = '$aws/things/{deviceId}/shadow/update';
const TOPIC_SHADOW_UPDATE_ACCEPTED = '$aws/things/{deviceId}/shadow/update/accepted';
const TOPIC_SHADOW_UPDATE_REJECTED = '$aws/things/{deviceId}/shadow/update/rejected';
const TOPIC_SHADOW_UPDATE_DELTA = '$aws/things/{deviceId}/shadow/update/delta';

// Device ports (for NCP messages via MQTT)
const PORT_STATUS = 'Status';
const PORT_CONTROL = 'Control';
const PORT_CONFIG = 'Config';
const PORT_FILTER_READ = 'filtRd';

// Fan speed range (AC3737 has 2 manual speeds, protocol max is 16)
const FAN_SPEED_MIN = 1;
const FAN_SPEED_MAX = 2;

// Token refresh buffer (refresh 5 min before expiry)
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// MQTT credentials refresh (1 hour validity, refresh at 50 min)
const MQTT_CREDENTIALS_REFRESH_MS = 50 * 60 * 1000;

// Reconnection settings
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 300000;

module.exports = {
    // OAuth
    OIDC_ISSUER,
    OIDC_REDIRECT_URI,
    OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET,
    OIDC_SCOPES,

    // MxChip API
    MXCHIP_API_HOST,
    MXCHIP_API_BASE,
    MXCHIP_APP_ID,
    MXCHIP_HMAC_SECRET,
    MXCHIP_USER_AGENT,
    MXCHIP_SERVER_TIME,
    MXCHIP_GET_TOKEN,
    MXCHIP_DEVICE_LIST,
    MXCHIP_MQTT_INFO,
    MXCHIP_UPDATE_LANGUAGE,

    // AWS IoT
    AWS_IOT_ENDPOINT,
    AWS_IOT_REGION,

    // Shadow Topics
    TOPIC_SHADOW_GET,
    TOPIC_SHADOW_GET_ACCEPTED,
    TOPIC_SHADOW_GET_REJECTED,
    TOPIC_SHADOW_UPDATE,
    TOPIC_SHADOW_UPDATE_ACCEPTED,
    TOPIC_SHADOW_UPDATE_REJECTED,
    TOPIC_SHADOW_UPDATE_DELTA,

    // Ports
    PORT_STATUS,
    PORT_CONTROL,
    PORT_CONFIG,
    PORT_FILTER_READ,

    // Fan
    FAN_SPEED_MIN,
    FAN_SPEED_MAX,

    // Timing
    TOKEN_REFRESH_BUFFER_MS,
    MQTT_CREDENTIALS_REFRESH_MS,
    RECONNECT_BASE_MS,
    RECONNECT_MAX_MS,
};
