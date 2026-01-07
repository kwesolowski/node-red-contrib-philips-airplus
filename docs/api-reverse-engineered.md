# Philips Air+ API - Reverse Engineered

Captured from Android app traffic on 2026-01-06 using mitmproxy + Frida SSL bypass.

## API Endpoints Summary

### 1. MxChip/Fog API (Main Device API)

**Host**: `23.38.108.31` (fog-da.philips.com.cn)

Used for Philips air purifiers using MxChip IoT platform.

#### Get Server Time

```http
GET /device/serverTime/
User-Agent: MxChip&Fog&Hyj#com.philips.ph.homecare#_v3.16.1
Accept-Encoding: gzip

Response 200 OK:
{
    "data": {
        "timestamp1": 1767669312,
        "timestamp2": "1767669312",
        "datetime1": "2026-01-06 03:15:12",
        "datetime2": "2026年1月6日 3时15分12秒",
        "week1": 2,
        "week2": "Tuesday",
        "week3": "周二",
        "week4": "星期二"
    },
    "meta": {
        "code": 0,
        "message": "server time"
    }
}
```

#### Get Token

```http
POST /enduser/v2/getToken/
Content-Type: application/json; charset=utf-8
User-Agent: MxChip&Fog&Hyj#com.philips.ph.homecare#_v3.16.1
signature: 9d999b3c888b09c10c2e406f7aa83d4c20580aaeea4523ad2fef208a6723ccd2

{
    "timestamp": "1767669312",
    "username": "ahc:id=5790965ee892b099963b9937a45f4510",
    "app_id": "9fd505fa9c7111e9a1e3061302926720"
}

Response 200 OK:
{
    "data": {
        "enduser_id": "ahc:id=5790965ee892b099963b9937a45f4510_9fd505fa9c7111e9a1e3061302926720",
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    },
    "meta": {
        "code": 0,
        "message": "enduser get token successful"
    }
}
```

**Signature Algorithm**: Double HMAC-SHA256 (verified via Frida runtime capture)

**Secret Key**: `a_zagf9sb2dpbiImtycwibgfzd6nksd65m`

- Extracted at runtime using Frida hook on `HttpRequestManager.setSecret()`
- Stored encrypted in APK, decrypted via `l6.a.e()` using AES/GCM

**Signature Generation Steps**:

1. Build params string with URL-encoded username, sorted alphabetically:
   ```
   app_id={app_id}&timestamp={timestamp}&username={url_encoded_username}
   ```
2. First HMAC: `hmac1 = HMAC-SHA256(params_string, secret_key).hex()`
3. Second HMAC: `signature = HMAC-SHA256(hmac1_hex, username).hex()` (NOTE: data=hmac1, key=username)

**Python Implementation**:

```python
import hmac
import hashlib
from urllib.parse import quote

def generate_signature(app_id: str, timestamp: str, username: str) -> str:
    secret = "a_zagf9sb2dpbiImtycwibgfzd6nksd65m"

    # Build params string (alphabetically sorted keys)
    username_encoded = quote(username, safe='')
    params = f"app_id={app_id}&timestamp={timestamp}&username={username_encoded}"

    # Double HMAC-SHA256
    # First: HMAC(params, secret)
    hmac1 = hmac.new(secret.encode(), params.encode(), hashlib.sha256).hexdigest()
    # Second: HMAC(hmac1_hex, username) - data is hmac1, key is username
    signature = hmac.new(username.encode(), hmac1.encode(), hashlib.sha256).hexdigest()

    return signature
```

**Verified Example** (from Frida capture):

- Input: `app_id=9fd505fa9c7111e9a1e3061302926720, timestamp=1767670901, username=ahc:id=5790965ee892b099963b9937a45f4510`
- HMAC1: `f2daf1cd9cb7b107f44be0042008b3325badf7cd9ea92403b736133fffe270dd`
- Signature: `1dd7def42a90e33a71b58037273400c73799b379bdeaa298aada4192962103a0`

**JWT Token Decoded**:

```json
{
  "identification": "ahc:id=5790965ee892b099963b9937a45f4510",
  "enduser_id": "u_ahc:id=5790965ee892b099963b9937a45f4510_9fd505fa9c7111e9a1e3061302926720",
  "app_id": "9fd505fa9c7111e9a1e3061302926720",
  "create_time": "2026-01-06T03:15:12.886071+0000",
  "exp": 1768274112,
  "orig_iat": 1767669312
}
```

Token expires in ~7 days (604800 seconds).

#### Get Device List

```http
GET /enduser/deviceList/
Authorization: jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
User-Agent: MxChip&Fog&Hyj#com.philips.ph.homecare#_v3.16.1
Accept-Encoding: gzip

Response 200 OK:
{
    "meta": {
        "code": 0,
        "message": "Get device list by user successful"
    },
    "data": []  // Empty if no devices bound
}
```

#### Update Language

```http
POST /enduser/updateLanguage/
Authorization: jwt <token>
Content-Type: application/json; charset=utf-8
User-Agent: MxChip&Fog&Hyj#com.philips.ph.homecare#_v3.16.1

{
    "lan_code": "EN",
    "country_code": "US"
}

Response 200 OK:
{
    "data": {},
    "meta": {
        "message": "Update language successful",
        "code": 0
    }
}
```

### 2. Air Matters API

**Host**: `data.air-matters.com` (23.92.25.169)

App configuration and device catalog.

#### App Config

```http
POST /3By9ZxlO_unbI_Vv
Content-Type: application/json; charset=utf-8
x-am-authentication: 5BfRU0nxj4aKbgxUvt5czkX4/NI=
x-am-app: Iw1MKWYuDQr5K9Rw
User-Agent: HomeCare/3.16.1 (Android; Android 14; google sdk_gphone64_arm64) App GooglePlay

{
    "scope": ["conf", "standards", "nearby", "saved_places"],
    "user_info": {
        "device_type": "Android",
        "device_os": "14",
        "device_brand": "google",
        "device_model": "sdk_gphone64_arm64",
        "display_scale": 2.625,
        "locale": "US",
        "time_zone_name": "Europe/Warsaw",
        "install_date": "2026-01-06",
        "lang": "en",
        "idfv": "5790965ee892b099963b9937a45f4510",
        "theme": "light",
        "app_type": "HomeCare",
        "app_version": "3.16.1"
    },
    "context": "app",
    "app_type": "HomeCare",
    "saved_places": []
}

Response 200 OK:
{
    "conf": {
        "appliance": {
            "brands": [{
                "key": "philips",
                "models": [...]
            }]
        }
    }
}
```

**Key Discovery**: The `idfv` field in Air Matters request matches the `ahc:id` hash!
This suggests the user identifier is derived from a device-based identifier, not the OAuth token directly.

### 3. Philips OAuth (home.id)

**Host**: `cdc.accounts.home.id`

OIDC with PKCE flow. Traffic not captured due to Chrome WebView SSL pinning.

#### Authorize

```
GET /oidc/op/v1.0/4_JGZWlP8eQHpEqkvQElolbA/authorize

Query params:
  client_id: -XsK7O6iEkLml77yDGDUi0ku
  code_challenge: <PKCE challenge>
  code_challenge_method: S256
  response_type: code
  redirect_uri: com.philips.air://loginredirect
  scope: openid email profile address DI.Account.read ...
```

### 4. Configuration API

**Host**: `13.227.146.48` (AWS CloudFront)

```
GET /configuration?countryCode=US
```

### 5. Push Notifications

**Host**: `139.162.109.115`

```
POST /register
POST /feeds/articles
```

### 6. Notices

**Host**: `45.79.80.248`

```
POST /get_notice
```

## Device Models (from Air Matters API)

AC3737/10 is listed as model "Carnation":

```json
{
    "model": "Carnation",
    "name": "AC3737/10",
    "privacy_url": "https://www.usa.philips.com/a-w/mobile-privacy-notice/clean-home-app.html",
    "purchase_url": "https://www.philips.com",
    "support_url": "https://www.philips.com/support",
    "terms_url": "https://www.home.id/policy/terms-of-service"
}
```

Other model codenames:

- **Pegasus**: AMF765, AMF870, AMF865, AMF970
- **Apollo**: CX5120
- **Trident**: CX3550
- **Stargazer**: HU5710 (humidifiers)
- **Pluto**: AC0850
- **Mars3000**: AC3021, AC3033, AC3036, etc.
- **Mars4000**: AC3833, AC3836, AC3837, AC3851, etc.
- **MarsLE**: AC2939, AC2958, AC2959
- **AC2889**: Older model with local HTTP API
- **AC2729**: Older model with local HTTP API

## Authentication Flow

01. User opens app
02. App generates IDFV (device identifier) - stored as `idfv`
03. OAuth redirect to `cdc.accounts.home.id`
04. User logs in via Google/Apple/Email
05. OAuth callback returns authorization code
06. App exchanges code for tokens (id_token, access_token)
07. App derives `ahc:id=<hash>` - appears to be MD5 or similar of IDFV
08. App calls `/device/serverTime/` to get timestamp
09. App calls `/enduser/v2/getToken/` with:
    - `username`: `ahc:id=<idfv_hash>`
    - `app_id`: `9fd505fa9c7111e9a1e3061302926720`
    - `timestamp`: Server timestamp (string)
    - `signature`: HMAC-SHA256 of request
10. MxChip returns JWT token (valid 7 days)
11. App calls `/enduser/deviceList/` with JWT

## Key Identifiers

| Identifier         | Value                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------- |
| OIDC Tenant        | `4_JGZWlP8eQHpEqkvQElolbA`                                                               |
| OAuth Client ID    | `-XsK7O6iEkLml77yDGDUi0ku`                                                               |
| MxChip App ID      | `9fd505fa9c7111e9a1e3061302926720`                                                       |
| MxChip HMAC Secret | `a_zagf9sb2dpbiImtycwibgfzd6nksd65m`                                                     |
| Air Matters App ID | `Iw1MKWYuDQr5K9Rw`                                                                       |
| Air Matters Secret | `pI0FqZwRp4u_ON6U`                                                                       |
| MxChip API Host    | `23.38.108.31`                                                                           |
| Air Matters Host   | `23.92.25.169`                                                                           |
| Philips API URL    | `https://www.api.air.philips.com/`                                                       |
| ECD Portal URL     | `https://www.ecdinterface.philips.com/DevicePortalICPRequestHandler/RequestHandler.ashx` |
| Cloud Client ID    | `000000fff0000024`                                                                       |
| Cloud Client Key   | `68e7f2ef8f445d56343e53ffed7cab05`                                                       |

## Rate Limits

From response headers:

- `/device/serverTime/`: 5 req/sec
- `/enduser/deviceList/`: 10 req/sec

## Device Binding

Devices are bound to users during WiFi provisioning (EWS - Easy Wireless Setup).
Device list is empty for new logins without bound devices.

To bind devices, the app uses:

- Local AP provisioning (device creates WiFi hotspot)
- mDNS/CoAP discovery on local network
- Device claim by serial/MAC via cloud API (not captured)

## Device Control via AWS IoT

### MQTT Connection

Devices are controlled via AWS IoT Core using MQTT over WebSocket. The `/enduser/v2/mqttInfo/` endpoint provides presigned WebSocket URLs with temporary AWS credentials.

#### Get MQTT Connection Info

```http
POST /enduser/v2/mqttInfo/
Authorization: jwt <token>
Content-Type: application/json; charset=utf-8

{
    "device_id": ["99d5086d8f9f11eeb22913de1077e90c"]
}

Response 200 OK:
{
    "data": {
        "mqttinfos": [
            {
                "host": "wss://a2gv4wmvb0sdt5-ats.iot.eu-central-1.amazonaws.com/mqtt?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
                "endpoint": "a2gv4wmvb0sdt5-ats.iot.eu-central-1.amazonaws.com",
                "path": "/mqtt?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
                "client_id": "ade23e61eab811f09566069b107a7ca5",
                "device_id": "99d5086d8f9f11eeb22913de1077e90c"
            }
        ]
    },
    "meta": {"code": 0, "message": "..."}
}
```

The `host` field contains a ready-to-use WebSocket URL with AWS SigV4 credentials (valid 1 hour).

### AWS IoT Shadow Topics

Device control uses standard AWS IoT Device Shadow topics:

| Topic                                            | Purpose                        |
| ------------------------------------------------ | ------------------------------ |
| `$aws/things/{thingName}/shadow/get`             | Request current device state   |
| `$aws/things/{thingName}/shadow/get/accepted`    | Subscribe: state response      |
| `$aws/things/{thingName}/shadow/get/rejected`    | Subscribe: request errors      |
| `$aws/things/{thingName}/shadow/update`          | Publish desired state changes  |
| `$aws/things/{thingName}/shadow/update/accepted` | Subscribe: update confirmation |
| `$aws/things/{thingName}/shadow/update/rejected` | Subscribe: update errors       |

**Note**: `thingName` is the `device_id` (e.g., `99d5086d8f9f11eeb22913de1077e90c`).

### Shadow Document Structure

```json
{
    "state": {
        "desired": {
            "powerOn": true
        },
        "reported": {
            "powerOn": true,
            "connected": true,
            "productState": "running",
            "productError": null,
            "ncpFirmwareVersion": "1.0.0",
            "hostFirmwareVersion": "1.0.4",
            "locale": "en_US",
            "timezones": {
                "posix": "CET-1CEST,M3.5.0,M10.5.0/3",
                "iana": "Europe/Warsaw"
            },
            "subscriptionLevel": 0,
            "shouldFactoryReset": false,
            "ota": 0
        }
    },
    "timestamp": 1767673935,
    "version": 123
}
```

### Control Commands

**Power On/Off:**

```json
{
    "state": {
        "desired": {
            "powerOn": true
        }
    }
}
```

Publish to: `$aws/things/{device_id}/shadow/update`

## Device List Response

Full response from `/enduser/deviceList/`:

```json
{
    "meta": {"code": 0, "message": "Get device list by user successful"},
    "data": [
        {
            "enduser_id": "PHILIPS:99957fe6-4ca7-4cf7-91ea-c095d8de91df_9fd505fa9c7111e9a1e3061302926720",
            "device_id": "99d5086d8f9f11eeb22913de1077e90c",
            "app_id": "9fd505fa9c7111e9a1e3061302926720",
            "registration_id": "9FCBD4E4CA237C37C8E2A1C3204E7C73E2CB3D281E1108AB2A0E2BCAF116D767",
            "is_push": true,
            "device_info": {
                "device_alias": "My Device",
                "binding_time": "2023-11-30T23:33:42.295299+0000",
                "activate_time": "2023-11-30-16",
                "product_id": "32681542d91811eda99406d016384e4a",
                "mac": "849DC2BFEEC6",
                "modelid": "AC3737/10",
                "name": "Bedroom",
                "record_time": "2023-11-30-16",
                "type": "Carnation",
                "is_online": true,
                "service_region": "eu-central-1",
                "activate_ip": "89.73.44.56",
                "device_id": "99d5086d8f9f11eeb22913de1077e90c",
                "swversion": "1.0.4",
                "isAISetup": 0
            }
        }
    ]
}
```

## User ID Format

The app uses two user ID formats:

1. **OAuth User ID** (from Philips home.id): `PHILIPS:99957fe6-4ca7-4cf7-91ea-c095d8de91df`
2. **MxChip Enduser ID**: `PHILIPS:99957fe6-4ca7-4cf7-91ea-c095d8de91df_9fd505fa9c7111e9a1e3061302926720`

The HMAC signature uses the OAuth User ID as `username`.

## Open Questions

1. ~~**Signature Secret**~~: RESOLVED - `a_zagf9sb2dpbiImtycwibgfzd6nksd65m`
2. ~~**Device Control API**~~: RESOLVED - AWS IoT Device Shadow via MQTT WebSocket
3. **Air quality properties**: Exact property names for PM2.5, humidity, fan speed, mode

## Implementation Status

| Component                       | Status                 |
| ------------------------------- | ---------------------- |
| Authentication (HMAC signature) | ✅ Documented          |
| Device list API                 | ✅ Documented          |
| MQTT connection info            | ✅ Documented          |
| AWS IoT Shadow topics           | ✅ Documented          |
| Power control                   | ✅ Documented          |
| Air quality readings            | ⏳ Need property names |
| Fan speed control               | ⏳ Need property names |
| Mode control                    | ⏳ Need property names |

## Next Steps

1. ~~Decompile APK to find signature algorithm~~ DONE
2. ~~Extract runtime secret~~ DONE
3. ~~Capture device control traffic~~ DONE
4. **Implement Node-RED node** - Use captured API
5. **Discover air quality properties** - Hook shadow document parsing or experiment

## Frida Scripts

Located in `tools/` directory.

### SSL Bypass

File: `tools/frida-ssl-bypass.js`

- Bypasses TrustManagerImpl, OkHttp3 CertificatePinner, SSLContext, etc.
- Run: `frida -U -f com.philips.ph.homecare -l tools/frida-ssl-bypass.js`

### Secret Extraction

File: `tools/frida-get-secret.js`

- Hooks `l6.a.e()` decryption and `HttpRequestManager.setSecret()`
- Captures actual HMAC inputs/outputs
- Run: `frida -U -f com.philips.ph.homecare -l tools/frida-get-secret.js`

## SDK Components (from decompilation)

- **Gaoda SDK** (`com.gaoda.*`): HTTP client, HMAC signature, device binding
- **FogCloud SDK** (`io.fogcloud.*`): EasyLink WiFi provisioning, RC4 encryption
- **Californium** (`org.eclipse.californium.*`): CoAP protocol support
- **Paho MQTT** (`org.eclipse.paho.*`): MQTT client for real-time device communication
