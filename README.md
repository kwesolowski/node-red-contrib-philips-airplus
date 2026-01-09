# node-red-contrib-philips-airplus

Node-RED nodes for Philips Air+ purifiers and humidifiers via cloud API.

## Features

- Real-time device status via WebSocket MQTT
- OAuth authentication (same as mobile app)
- Supports multiple devices per account
- Auto token refresh

## Supported Devices

**AC3737** and other v3 protocol devices only. This package uses the v3 AWS IoT protocol with field names like `D03102` (power) and `D0310C` (mode).

Older devices using v1 or v2 protocols are not supported.

## Installation

### Via npm

```bash
cd ~/.node-red
npm install node-red-contrib-philips-airplus
```

Then restart Node-RED.

### Via Palette Manager

1. Open Node-RED editor
2. Menu → Manage palette → Install tab
3. Search for "philips-airplus"
4. Click Install

## Nodes

### airplus-account (config node)

Manages authentication and connection to Philips cloud.

**Setup:**

1. Add config node and click "Get Auth URL"
2. Open URL in browser, log in to Philips account
3. Copy redirect URL (`com.philips.air://loginredirect?code=...`)
4. Paste in config node and click "Exchange Code"

### airplus-status

Receives real-time status updates from a device.

**Output:**

```javascript
msg.payload = {
    power: true,           // on/off
    mode: 'auto',          // auto, sleep, turbo, manual
    fanSpeed: 8,           // 1-18
    pm25: 12,              // ug/m3
    humidity: 45,          // %
    temperature: 22,       // celsius
    timestamp: 1704067200000
};
msg.deviceId = 'da-xxx';
msg.deviceName = 'Living Room';
```

### airplus-control

Sends control commands to a device.

**Partial updates supported:** Send only the properties you want to change. Omitted properties remain unchanged.

**Input (simple format):**

```javascript
// Change any combination of properties:
msg.payload = {
    power: true,           // on/off (optional)
    mode: 'auto',          // auto, sleep, turbo, manual (optional)
    fanSpeed: 1,           // 1-2 manual speed (optional, AC3737 has 2 speeds)
    targetHumidity: 50,    // 40-70, humidifiers only (optional)
    childLock: false,      // boolean (optional)
    displayLight: 50       // 0-100: 0=off, 50=dim, 100=bright (optional)
};
```

**Partial update examples:**

```javascript
msg.payload = { power: true };              // Just turn on, keep mode
msg.payload = { mode: 'sleep' };            // Just change mode
msg.payload = { power: true, mode: 'auto' }; // Turn on in auto mode
msg.payload = { fanSpeed: 12 };             // Just adjust fan speed
```

**Refresh command:**

```javascript
msg.topic = 'refresh';
msg.payload = {};  // ignored
```

**Outputs:**

- Port 1: Success with `msg.controlResult`
- Port 2: Error with `msg.error`

**Usage with inject nodes:**

```
[Inject: {power: true}]      → Power On
[Inject: {power: false}]     → Power Off
[Inject: {mode: 'auto'}]     → Auto Mode
[Inject: {mode: 'sleep'}]    → Sleep Mode
[Inject: {fanSpeed: 12}]     → Change Fan Speed
[Inject: topic='refresh']    → Fetch Status
```

## CLI Authentication Tool

The package includes a CLI tool for authenticating outside of Node-RED:

```bash
npm run auth
```

**Note:** The headless Playwright approach is recommended as the manual method's reliability depends on browser behavior.

To install Playwright for headless auth:

```bash
npm install --no-save playwright
```

## Examples

See [`examples/control-test.json`](examples/control-test.json) for a complete test flow with inject nodes for all control commands.

## Troubleshooting

### OAuth authentication fails

- Check browser popup blockers
- Try CLI auth tool: `npm run auth`
- Ensure you're using correct Philips account credentials

### MQTT connection issues

- Verify device is online in Philips app
- Check credentials haven't expired (re-authenticate if needed)
- Account node shows connection status for each device

### Node shows "disconnected"

- Account config may need re-authentication
- Click "Clear Credentials" and authenticate again

## Disclaimer

This package is based on reverse-engineered protocol from the official Philips Air+ Android app. It is **not affiliated with or endorsed by Philips**.

**Compatibility:**
- Supports v3 protocol devices (AC3737/Carnation, Apollo series)
- V1/V2 devices are not compatible

**Stability:** Protocol may change if Philips updates their cloud API. This is version 0.x indicating the API surface may evolve.

## Protocol

Based on reverse-engineered Philips Air+ cloud API (v3 protocol):

- OAuth via `cdc.accounts.home.id` (Philips home.id OIDC)
- REST API at `www.api.air.philips.com` (MxChip/FogCloud)
- MQTT over WebSocket at AWS IoT Core (`ats.iot.eu-central-1.amazonaws.com`)

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test
```

## Credits

Protocol based on [philips-airplus-homeassistant](https://github.com/ShorMeneses/philips-airplus-homeassistant).

## License

MIT
