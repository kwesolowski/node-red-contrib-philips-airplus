# node-red-contrib-philips-airplus

Node-RED nodes for Philips Air+ purifiers and humidifiers via cloud API.

## Features

- Real-time device status via WebSocket MQTT
- OAuth authentication (same as mobile app)
- Supports multiple devices per account
- Auto token refresh

## Supported Devices

Tested with AC3737. Should work with other Philips Air+ app compatible devices.

## Installation

```bash
cd ~/.node-red
npm install /path/to/node-red-contrib-philips-airplus
```

Then restart Node-RED.

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

**Input (simple format):**

```javascript
msg.payload = {
    power: true,           // on/off
    mode: 'auto',          // auto, sleep, turbo, manual
    fanSpeed: 8,           // 1-18
    targetHumidity: 50,    // 40-70 (humidifiers only)
    childLock: false,      // boolean
    displayLight: 1        // 0-2 (0=off, 1=dim, 2=bright)
};
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
[Inject: topic='refresh']    → Fetch Status
```

## Protocol

Based on reverse-engineered Philips Air+ cloud API:

- OAuth via `cdc.accounts.home.id`
- REST API at `prod.eu-da.iot.versuni.com`
- MQTT over WebSocket at `ats.prod.eu-da.iot.versuni.com`

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
