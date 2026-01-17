# Reliability Design

## Core Principle

**These nodes must operate reliably without manual intervention.** Transient network issues, credential refreshes, and temporary AWS IoT unavailability are expected operational conditions - not errors requiring user action.

## Expected Behavior

### Normal Operations

1. **Startup**: Connect to AWS IoT, fetch device state, subscribe to updates
2. **Credential expiry** (every ~1 hour): Automatically refresh presigned WebSocket URLs, reconnect seamlessly
3. **Network glitches**: Automatically reconnect with exponential backoff
4. **AWS IoT maintenance**: Retry connection, respect circuit breaker

### Automatic Recovery

The following scenarios MUST recover automatically without user intervention:

- MQTT disconnection (network blip, AWS IoT restart)
- Presigned URL expiry (~1 hour)
- Temporary AWS IoT unreachability
- Token refresh (OAuth tokens, every few days)
- Device temporarily offline in Philips cloud

### When Manual Action is Required

Only log ERROR when user action is genuinely needed:

- **OAuth refresh token expired** (user must re-authenticate - happens after ~30 days of inactivity)
- **Philips account suspended/locked**
- **Device removed from account**
- **Persistent AWS IoT rejection** (bad credentials after multiple refresh attempts)

## Logging Strategy

### log() - Normal Operations
- Connection established
- Credential refresh triggered
- Device state changes received
- Subscriptions added/removed

### warn() - Transient Issues (Auto-Recoverable)
- MQTT disconnected (will auto-reconnect)
- Connection attempt failed (will retry)
- Circuit breaker half-open (testing connection)

### error() - Requires Action
- OAuth refresh token expired → "Re-authenticate required: Click 'Get Auth URL' in config node"
- Persistent connection failure after circuit breaker opens → "Unable to reach AWS IoT after multiple attempts. Check internet connectivity and Philips cloud status."
- Invalid device ID in API response → "Device configuration issue, contact support"

## Observability

### Node Status Indicators

**Green dot**: Connected, receiving updates
**Yellow ring**: Connecting/reconnecting (automatic, normal)
**Orange dot**: Circuit breaker backing off (temporary, will retry)
**Red ring**: Action required (see error log)

Status text shows:
- Connected: `connected (3 devices)`
- Connecting: `connecting... (attempt 2/10)`
- Circuit breaker: `backing off (retry in 3m)`
- Error: `authentication required`

### Debug Output (when enabled)

Enable verbose logging in account config for troubleshooting:
- MQTT topic subscriptions
- Shadow message payloads
- Reconnection timing
- Circuit breaker state changes

## Circuit Breaker Design

- **Closed** (normal): Connections succeed
- **Open** (backing off): After 10 consecutive failures, wait 5 minutes before retry
- **Half-open** (testing): Attempt one connection to test if service recovered

Circuit breaker prevents:
- Hammering AWS IoT during outages
- Log spam during extended unavailability
- Battery drain on Pi during network issues

## Metrics for Monitoring

For production deployment, consider tracking:
- Connection uptime %
- Reconnection frequency
- Circuit breaker trips
- Time-to-recovery after disconnect

## Testing Scenarios

Verify automatic recovery:

1. **Network disconnect**: Unplug Pi ethernet, wait 30s, reconnect → should recover
2. **AWS IoT maintenance**: Wait for AWS scheduled maintenance → should recover
3. **Credential expiry**: Wait 1 hour after deploy → should refresh and reconnect
4. **Token expiry**: Don't use for 7 days → should refresh OAuth token automatically
5. **Node-RED restart**: `systemctl restart nodered` → should reconnect all devices

## Implementation Checklist

- [x] Exponential backoff reconnection (1s → 5min)
- [x] Automatic credential refresh (50min timer)
- [x] Circuit breaker (10 failures → 5min backoff)
- [ ] Distinguish transient vs permanent errors in logging
- [ ] Rich node status with retry countdown
- [ ] OAuth token refresh (when refresh_token still valid)
- [ ] Metrics emission (optional, for Grafana)

## Design Rationale

**Why automatic refresh at 50min?**
Presigned WebSocket URLs expire at ~60min. Refreshing at 50min provides 10min buffer for API slowness or retries.

**Why circuit breaker at 10 failures?**
With exponential backoff (1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 300s), 10 attempts take ~13 minutes. If still failing after 13 minutes, likely a persistent outage - back off for 5 minutes.

**Why not log errors during reconnection?**
Transient failures are expected. Only the final state matters: did we recover? Logging every attempt creates alert fatigue and obscures genuine issues.

**Why separate credentials file?**
Node-RED credentials are stored in flows_cred.json (git-ignored). CLI credentials file (`~/.philips-airplus/credentials.json`) allows:
- Reusing auth across Node-RED restarts
- CLI tool access (status checks, control commands)
- Cross-machine credential transfer (export/import)
