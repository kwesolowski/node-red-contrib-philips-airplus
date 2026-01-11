/**
 * Parser for Philips Air+ AWS IoT Shadow messages.
 * Converts shadow state to normalized status format.
 * V3 protocol only - supports AC3737 and other v3 devices.
 */

/**
 * Parse AWS IoT Shadow document into normalized status.
 * @param {object} shadow - Shadow document from AWS IoT
 * @returns {{ reported: object, desired: object, timestamp: number }}
 */
function parseShadow(shadow) {
  if (!shadow || typeof shadow !== 'object') {
    return null;
  }

  const state = shadow.state || {};
  return {
    reported: state.reported ? parseReportedState(state.reported) : {},
    desired: state.desired || {},
    timestamp: shadow.timestamp,
    version: shadow.version,
  };
}

/**
 * Parse reported state from shadow into normalized format.
 * Supports multiple protocol versions:
 * - v3: AC3737, AC3xxx - uses DIDs like D03102, D03221
 * - v2: older devices - uses D03-02, D03-33
 * - v1: legacy - uses pwr, pm25, mode
 * @param {object} reported - Reported state from shadow
 * @returns {object} Normalized status
 */
function parseReportedState(reported) {
  const status = {
    raw: reported,
  };

  // Power state - v3 protocol
  if ('D03102' in reported) {
    status.power = reported.D03102 === 1;
  }

  // Connected state
  if ('connected' in reported) {
    status.connected = Boolean(reported.connected);
  }

  // Product state (running, standby, etc.)
  if ('productState' in reported) {
    status.productState = reported.productState;
  }

  // Product error
  if ('productError' in reported) {
    status.error = reported.productError;
  }

  // Mode - v3 protocol: D0310C numeric codes
  // 0=auto, 17=sleep, 18=turbo, 1-16=manual fan speeds
  if ('D0310C' in reported) {
    const modeCode = parseInt(reported.D0310C, 10);
    status.modeRaw = modeCode;
    if (modeCode === 0) {
      status.mode = 'auto';
    } else if (modeCode === 17) {
      status.mode = 'sleep';
    } else if (modeCode === 18) {
      status.mode = 'turbo';
    } else if (modeCode >= 1 && modeCode <= 16) {
      status.mode = 'manual';
      status.fanSpeed = modeCode;
    } else {
      status.mode = `mode_${modeCode}`;
    }
  }

  // PM2.5 (particulate matter) - v3 protocol
  if ('D03221' in reported) {
    status.pm25 = parseInt(reported.D03221, 10);
  }

  // Humidity - v3 protocol
  if ('D03125' in reported) {
    status.humidity = parseInt(reported.D03125, 10);
  }

  // Temperature - v3 protocol (divided by 10)
  if ('D03224' in reported) {
    status.temperature = parseInt(reported.D03224, 10) / 10;
  }

  // Air quality index - v3 protocol
  if ('D03120' in reported) {
    status.airQualityIndex = parseInt(reported.D03120, 10);
  }

  // Target humidity (for humidifiers) - v3 protocol
  if ('D03128' in reported) {
    status.targetHumidity = parseInt(reported.D03128, 10);
  }

  // Child lock - v3 protocol
  if ('D03103' in reported) {
    status.childLock = reported.D03103 === 1;
  }

  // Display brightness - v3 protocol
  if ('D03105' in reported) {
    status.displayLight = parseInt(reported.D03105, 10);
  }

  // Firmware versions
  if ('ncpFirmwareVersion' in reported) {
    status.ncpFirmwareVersion = reported.ncpFirmwareVersion;
  }
  if ('hostFirmwareVersion' in reported) {
    status.hostFirmwareVersion = reported.hostFirmwareVersion;
  }

  // Timezone
  if ('timezones' in reported) {
    status.timezone = reported.timezones.iana || reported.timezones.posix;
  }

  // Filter status - v3 uses D05xxx DIDs
  if ('D0540E' in reported) {
    status.filter = status.filter || {};
    status.filter.replaceRemaining = parseInt(reported.D0540E, 10);
  }
  if ('D05408' in reported) {
    status.filter = status.filter || {};
    status.filter.replaceNominal = parseInt(reported.D05408, 10);
  }
  // v1 filter status
  if ('fltsts0' in reported) {
    status.filter = status.filter || {};
    status.filter.cleanRemaining = parseInt(reported.fltsts0, 10);
  }
  if ('fltsts1' in reported) {
    status.filter = status.filter || {};
    status.filter.replaceRemaining = parseInt(reported.fltsts1, 10);
  }
  if ('fltt0' in reported) {
    status.filter = status.filter || {};
    status.filter.cleanNominal = parseInt(reported.fltt0, 10);
  }
  if ('fltt1' in reported) {
    status.filter = status.filter || {};
    status.filter.replaceNominal = parseInt(reported.fltt1, 10);
  }

  // Calculate filter percentages
  if (status.filter) {
    if (status.filter.cleanNominal && status.filter.cleanRemaining !== undefined) {
      status.filter.cleanPercent = Math.round(
        (status.filter.cleanRemaining / status.filter.cleanNominal) * 100
      );
    }
    if (status.filter.replaceNominal && status.filter.replaceRemaining !== undefined) {
      status.filter.replacePercent = Math.round(
        (status.filter.replaceRemaining / status.filter.replaceNominal) * 100
      );
    }
  }

  return status;
}

/**
 * Build desired state update for device control.
 * @param {object} options - Control options
 * @param {boolean} [options.power] - Power on/off
 * @param {string} [options.mode] - Mode (auto, sleep, turbo, manual)
 * @param {number} [options.fanSpeed] - Fan speed (1-2 for AC3737)
 * @param {number} [options.targetHumidity] - Target humidity (40-70)
 * @param {boolean} [options.childLock] - Child lock on/off
 * @param {number} [options.displayLight] - Display brightness (0-100)
 * @returns {object} Desired state for shadow update
 */
function buildDesiredState(options) {
  const desired = {};

  // Power - v3 protocol uses D03102 with numeric 1/0
  if (options.power !== undefined) {
    desired.D03102 = options.power ? 1 : 0;
  }

  // Mode - v3 protocol uses D0310C with numeric codes
  // 0=auto, 17=sleep, 18=turbo, 1-16=manual (fan speed encoded in mode)
  if (options.mode !== undefined || options.fanSpeed !== undefined) {
    const mode = (options.mode || 'manual').toLowerCase();

    if (mode === 'auto') {
      desired.D0310C = 0;
    } else if (mode === 'sleep') {
      desired.D0310C = 17;
    } else if (mode === 'turbo') {
      desired.D0310C = 18;
    } else if (mode === 'manual' && options.fanSpeed !== undefined) {
      // Manual mode: fan speed 1-2 for AC3737 (protocol max is 16, but AC3737 only has 2 speeds)
      const fanSpeed = Math.max(1, Math.min(2, parseInt(options.fanSpeed, 10)));
      desired.D0310C = fanSpeed;
    }
  }

  // Target humidity - v3 protocol uses D03128
  if (options.targetHumidity !== undefined) {
    desired.D03128 = parseInt(options.targetHumidity, 10);
  }

  // Child lock - v3 protocol uses D03103
  if (options.childLock !== undefined) {
    desired.D03103 = options.childLock ? 1 : 0;
  }

  // Display light - v3 protocol uses D03105
  if (options.displayLight !== undefined) {
    desired.D03105 = parseInt(options.displayLight, 10);
  }

  return desired;
}

/**
 * Merge status updates.
 * @param {object} existing - Existing status
 * @param {object} update - New status update
 * @returns {object} Merged status
 */
function mergeStatus(existing, update) {
  const merged = { ...existing };

  for (const [key, value] of Object.entries(update)) {
    if (key === 'raw') {
      merged.raw = { ...existing.raw, ...update.raw };
    } else if (key === 'filter' && existing.filter) {
      merged.filter = { ...existing.filter, ...update.filter };
    } else if (value !== undefined) {
      merged[key] = value;
    }
  }

  merged.timestamp = Date.now();
  return merged;
}

module.exports = {
  parseShadow,
  parseReportedState,
  buildDesiredState,
  mergeStatus,
};
