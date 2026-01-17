# Observability and Self-Recovery Improvements

## Changes Summary

Improved error handling, observability, and automatic recovery to eliminate need for manual intervention during transient network issues.

## Key Improvements

### 1. Distinguish Transient vs Permanent Errors

**Before:**
- All MQTT connection failures logged as `error()`
- No distinction between recoverable network glitch and expired credentials
- Created alert fatigue and obscured genuine issues

**After:**
- Transient failures (network, AWS IoT maintenance) → `warn()` with "auto-retry enabled"
- Permanent failures (expired OAuth token) → `error()` with "manual intervention required"
- Only log errors when user action is genuinely needed

### 2. Temporal Context in Logs

**Before:**
```
MQTT error (Bedroom): MQTT connection timeout
```

**After:**
```
MQTT Bedroom: MQTT connection timeout (attempt 3/10), failing for 45s, last connected 120s ago - auto-retry enabled
```

Logs now include:
- **Attempt number** (3/10) - shows progress toward circuit breaker threshold
- **Failure duration** (45s) - how long we've been failing
- **Last connected** (120s ago) - when was last successful connection
- **Auto-retry status** - confirms system will recover automatically

### 3. Rich Node Status Indicators

**Before:**
```
yellow ring: "connecting..."
yellow ring: "disconnected"
```

**After:**
```
green dot: "connected (3 devices)"              # All connected
yellow ring: "connecting... (2/10)"             # Reconnecting with progress
yellow dot: "2 ok, 1 reconnecting"              # Partial connectivity
orange dot: "backing off (retry in 3m)"         # Circuit breaker active
red ring: "authentication required"             # User action needed
grey ring: "no devices"                         # No devices configured
```

Status provides actionable information at a glance.

### 4. Uptime and Downtime Tracking

Added connection state tracking:
- `lastConnectedAt` - timestamp of last successful connection
- `lastDisconnectedAt` - timestamp of last disconnect
- `firstFailureAt` - timestamp of first failure in current sequence

Used to calculate:
- Uptime before disconnect
- Downtime duration
- Failure sequence duration

Example logs:
```
[mqtt] Connected after 45s offline
[mqtt] Disconnected after 3600s uptime
```

### 5. Circuit Breaker Improvements

**Before:**
```
[mqtt] Circuit breaker OPEN - AWS IoT persistently unreachable, backing off for 5 minutes
```

**After:**
```
[mqtt] Circuit breaker OPEN - AWS IoT persistently unreachable, failing for 780s, last connected 900s ago, backing off for 5min
```

Circuit breaker messages now include temporal context to understand severity.

### 6. Credential Refresh Logging

**Before:** Silent refresh, errors logged as generic failures

**After:**
```
[mqtt] Refreshing MQTT credentials (presigned URL expired)
[mqtt] Credentials refreshed successfully
```

Explicitly logs when automatic credential refresh occurs (every 50 minutes).

## Design Principles

### Only Error When Action Required

`node.error()` reserved for:
- OAuth refresh token expired (user must re-authenticate)
- Persistent connection failure after circuit breaker trips
- Invalid configuration (bad device ID, etc.)

`node.warn()` for transient issues:
- MQTT disconnection (will auto-reconnect)
- Connection attempt failed (will retry)
- Credential refresh triggered

`node.log()` for normal operations:
- Connection established
- State updates received
- Subscriptions managed

### Temporal Awareness

Every warning/error includes:
- How long has this been failing?
- When was last success?
- What's the retry status?

This enables quick diagnosis:
- "Failing for 5s" → ignore, transient blip
- "Failing for 300s, last connected 600s ago" → investigate network
- "Failing for 1800s" → likely persistent outage, check Philips cloud status

### Self-Documenting Status

Node status text answers:
- What's happening? ("connecting", "backing off", "authentication required")
- How severe? (green=ok, yellow=transient, orange=backing off, red=action needed)
- When will it retry? ("retry in 3m")
- Progress? ("attempt 2/10")

## Testing Scenarios

Verify automatic recovery:

1. **Network disconnect**: Unplug Pi ethernet → yellow ring "connecting (1/10)" → reconnect → green dot
2. **AWS IoT maintenance**: Wait for scheduled maintenance → automatic reconnection
3. **Credential expiry**: Wait 1 hour → see "Refreshing MQTT credentials" log → seamless reconnect
4. **Persistent outage**: Unplug for 15 minutes → orange dot "backing off" → reconnect → green dot
5. **Node-RED restart**: `systemctl restart nodered` → automatic reconnection

## Migration Notes

**For users upgrading from previous versions:**

- **Fewer errors in logs** - transient connection issues no longer logged as errors
- **More informative warnings** - temporal context helps diagnose issues
- **Better status indicators** - at-a-glance understanding of connection state
- **No behavior changes** - same automatic reconnection, just better visibility

**Breaking changes:** None - API unchanged

## Files Modified

- `RELIABILITY.md` - New file documenting reliability design principles
- `README.md` - Updated troubleshooting section with new status indicators
- `nodes/airplus-account.js` - Enhanced error handling, status display, reconnection state tracking
- `lib/mqtt.js` - Added temporal tracking, improved logging, context in error callbacks

## Metrics for Monitoring (Future)

Consider exposing:
- Connection uptime percentage
- Reconnection frequency
- Circuit breaker trip count
- Mean time to recovery

These could feed into Grafana dashboards for production monitoring.
