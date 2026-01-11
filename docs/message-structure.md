# airplus-status Message Structure

## Actual Message from 'reported' Updates

When Air+ device pushes sensor updates via MQTT, airplus-status emits:

```json
{
  "payload": {
    "raw": {
      "D01102": 4,
      "D01S03": "Bedroom",
      "D01S04": "Carnation",
      "D01S05": "AC3737/10",
      "ProductId": "32681542d91811eda99406d016384e4a",
      "DeviceId": "99d5086d8f9f11eeb22913de1077e90c",
      "StatusType": "status",
      "ConnectType": "Online",
      "D03102": 1,           // Power: 1=on
      "D03103": 0,           // Child lock: 0=off
      "D03105": 100,         // Display brightness: 100%
      "D0310C": 0,           // Mode: 0=auto
      "D03120": 1,           // Air quality index: 1 (excellent)
      "D03221": 1,           // PM2.5: 1 µg/m³ ✅
      "D03224": 253,         // Temperature: 253 (÷10 = 25.3°C) ✅
      "D03125": 34,          // Humidity: 34% ✅
      "D03128": 40,          // Target humidity: 40%
      "D05102": 3,
      "D0540E": 2928,        // Filter remaining hours
      "rssi": -71,
      "free_memory": 60408,
      "Runtime": 720866219
    },
    "power": true,
    "modeRaw": 0,
    "mode": "auto",
    "pm25": 1,               // ✅ Parsed from D03221
    "humidity": 34,          // ✅ Parsed from D03125
    "temperature": 25,       // ✅ Parsed from D03224 (rounded)
    "airQualityIndex": 1,
    "targetHumidity": 40,
    "childLock": false,
    "displayLight": 100,
    "filter": {
      "replaceRemaining": 2928,
      "replaceNominal": 4800,
      "replacePercent": 61
    },
    "timestamp": 1768153032101
  },
  "deviceId": "99d5086d8f9f11eeb22913de1077e90c",
  "deviceName": "Bedroom",
  "topic": "99d5086d8f9f11eeb22913de1077e90c/reported",
  "updateType": "reported",
  "_msgid": "62b875206beb5256"
}
```

## Key Fields for InfluxDB Logging

The `payload` object contains parsed sensor fields:

| Field | Type | Example | Source | Notes |
|-------|------|---------|--------|-------|
| `temperature` | number | `25` | `D03224 ÷ 10` | Rounded to integer |
| `humidity` | number | `34` | `D03125` | Percentage 0-100 |
| `pm25` | number | `1` | `D03221` | Particulate matter µg/m³ |
| `airQualityIndex` | number | `1` | `D03120` | 0-12 scale |
| `power` | boolean | `true` | `D03102` | Device on/off |
| `mode` | string | `"auto"` | `D0310C` | auto/sleep/turbo/manual |

## Update Types

airplus-status emits different `updateType` values:

### 1. `"reported"` - Shadow State Push

Device pushes complete state to AWS IoT shadow (includes sensor readings).

**When**: Device sends periodic updates or state changes
**Payload**: ✅ **Contains sensor fields** (pm25, humidity, temperature)
**Frequency**: Variable, depends on device firmware

### 2. `"delta"` - Shadow Desired vs Reported Diff

AWS IoT publishes when `desired` state differs from `reported`.

**When**: After control command is sent but before device confirms
**Payload**: ⚠️ **Only changed fields** (usually power/mode, rarely sensors)

### 3. `"initial"` - Subscription Acknowledgment

Emitted immediately when airplus-status subscribes to device shadow.

**When**: Node-RED startup or reconnection
**Payload**: ❌ **Often has undefined fields** if shadow hasn't been updated recently
**Note**: airplus-influx-logger filters this out (skips logging)

### 4. `"manual"` - User-Triggered Shadow Get

Emitted when inject node triggers `msg` input to airplus-status.

**When**: Manual trigger via inject/debug
**Payload**: ⚠️ **May lack sensor fields** if device hasn't pushed recently
**Behavior**: Requests current shadow via `getDeviceState()`, returns whatever is cached in AWS IoT

## Why Manual Inject Shows Empty Sensors

When you inject a message to trigger airplus-status, it calls `getDeviceState()` which:

1. Publishes to `$aws/things/{deviceId}/shadow/get` (request current shadow)
2. Receives response from `$aws/things/{deviceId}/shadow/get/accepted`
3. Returns whatever is in the **shadow cache**

If the device hasn't pushed a sensor update recently, the shadow cache won't have `D03221`, `D03125`, `D03224` fields, resulting in:

```javascript
{
  payload: {
    temperature: undefined,
    humidity: undefined,
    pm25: undefined
  },
  updateType: "manual"
}
```

This is why airplus-influx-logger warns: **"No environmental metrics in payload"**

## Solution: Wait for Device Updates

To get sensor data in InfluxDB:

1. **Don't rely on manual inject** - it returns stale shadow
2. **Wait for automatic 'reported' updates** - device pushes these periodically
3. **Check InfluxDB after a few minutes** - data appears when device sends update

The AC3737 firmware pushes sensor updates at **unknown intervals** (needs observation to determine exact timing).

## Filtering Strategy

airplus-influx-logger only processes messages with sensor data:

```typescript
const updateType = msg.updateType || 'unknown';
if (updateType !== 'reported' && updateType !== 'delta' && updateType !== 'manual') {
    // Skip 'initial' and other types without sensor data
    return;
}

if (!msg.payload.temperature && !msg.payload.humidity && !msg.payload.pm25) {
    node.warn('No environmental metrics in payload');
    return;
}
```

This prevents duplicate/empty messages from cluttering InfluxDB.

## Verification

To verify sensor data is flowing:

```bash
# Enable debug logging
just debug-set airplus-influx-logger 1

# Watch for 'reported' messages with sensor data
just nodered-logs-follow | grep -E 'reported|Created.*points'

# Query InfluxDB for recent Air+ data
just influx-sql "SELECT time, room, metric, value FROM environment WHERE device_id LIKE '%99d5086d%' ORDER BY time DESC LIMIT 10"
```

Expected: Temperature, humidity, and PM2.5 all appear with same timestamp when device pushes update.
