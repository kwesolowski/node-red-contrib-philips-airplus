/**
 * Parser for Philips Air+ AWS IoT Shadow messages.
 * Converts shadow state to normalized status format.
 */

const { MODE_NAMES } = require('./constants');

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

    // Power state - try v3 DIDs first, then v1
    if ('D03102' in reported) {
        status.power = reported.D03102 === 1;
    } else if ('powerOn' in reported) {
        status.power = Boolean(reported.powerOn);
    } else if ('pwr' in reported) {
        status.power = reported.pwr === '1' || reported.pwr === 1 || reported.pwr === true;
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

    // Mode - v3 uses D0310C numeric codes, v1 uses letter codes
    // v3 modes: 0=auto, 17=sleep, 18=turbo, 1-10=manual fan speeds
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
    } else if ('mode' in reported) {
        status.mode = MODE_NAMES[reported.mode] || reported.mode;
        status.modeRaw = reported.mode;
    }

    // Fan speed - v1 only (v3 fan speed is encoded in mode)
    if (status.fanSpeed === undefined) {
        if ('om' in reported) {
            status.fanSpeed = parseInt(reported.om, 10) || 0;
        } else if ('fanSpeed' in reported) {
            status.fanSpeed = parseInt(reported.fanSpeed, 10) || 0;
        }
    }

    // PM2.5 (particulate matter) - v3 then v1
    if ('D03221' in reported) {
        status.pm25 = parseInt(reported.D03221, 10);
    } else if ('pm25' in reported) {
        status.pm25 = parseInt(reported.pm25, 10);
    }

    // Humidity - v3 then v1
    if ('D03125' in reported) {
        status.humidity = parseInt(reported.D03125, 10);
    } else if ('rh' in reported) {
        status.humidity = parseInt(reported.rh, 10);
    } else if ('humidity' in reported) {
        status.humidity = parseInt(reported.humidity, 10);
    }

    // Temperature - v3 (divided by 10) then v1
    if ('D03224' in reported) {
        status.temperature = Math.round(parseInt(reported.D03224, 10) / 10);
    } else if ('temp' in reported) {
        status.temperature = parseInt(reported.temp, 10);
    } else if ('temperature' in reported) {
        status.temperature = parseInt(reported.temperature, 10);
    }

    // Air quality index - v3 then v1
    if ('D03120' in reported) {
        status.airQualityIndex = parseInt(reported.D03120, 10);
    } else if ('iaql' in reported) {
        status.airQualityIndex = parseInt(reported.iaql, 10);
    } else if ('airQualityIndex' in reported) {
        status.airQualityIndex = parseInt(reported.airQualityIndex, 10);
    }

    // Target humidity (for humidifiers)
    if ('rhset' in reported) {
        status.targetHumidity = parseInt(reported.rhset, 10);
    } else if ('targetHumidity' in reported) {
        status.targetHumidity = parseInt(reported.targetHumidity, 10);
    }

    // Water level (for humidifiers)
    if ('wl' in reported) {
        status.waterLevel = parseInt(reported.wl, 10);
    } else if ('waterLevel' in reported) {
        status.waterLevel = parseInt(reported.waterLevel, 10);
    }

    // Child lock - v3 then v1
    if ('D0312B' in reported) {
        status.childLock = reported.D0312B === 1;
    } else if ('cl' in reported) {
        status.childLock = reported.cl === '1' || reported.cl === 1 || reported.cl === true;
    } else if ('childLock' in reported) {
        status.childLock = Boolean(reported.childLock);
    }

    // Light/display brightness - v3 then v1
    if ('D0310D' in reported) {
        status.displayLight = parseInt(reported.D0310D, 10);
    } else if ('uil' in reported) {
        status.displayLight = parseInt(reported.uil, 10);
    } else if ('displayLight' in reported) {
        status.displayLight = parseInt(reported.displayLight, 10);
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
 * @param {number} [options.fanSpeed] - Fan speed (1-18)
 * @param {number} [options.targetHumidity] - Target humidity (40-70)
 * @param {boolean} [options.childLock] - Child lock on/off
 * @param {number} [options.displayLight] - Display brightness (0-2)
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
            // Manual mode: fan speed 1-16 is encoded directly as mode value
            const fanSpeed = Math.max(1, Math.min(16, parseInt(options.fanSpeed, 10)));
            desired.D0310C = fanSpeed;
        }
    }

    if (options.targetHumidity !== undefined) {
        desired.rhset = String(options.targetHumidity);
    }

    if (options.childLock !== undefined) {
        desired.cl = options.childLock ? '1' : '0';
    }

    if (options.displayLight !== undefined) {
        desired.uil = String(options.displayLight);
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
