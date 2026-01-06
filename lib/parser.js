/**
 * Parser for Philips Air+ MQTT messages.
 * Converts raw device messages to normalized status format.
 */

const { MODE_NAMES, PORT_STATUS, PORT_FILTER_READ, PORT_CONFIG } = require('./constants');

/**
 * Parse raw MQTT message from device.
 * @param {object} message - Raw MQTT message
 * @returns {{ type: string, data: object } | null}
 */
function parseMessage(message) {
    if (!message || typeof message !== 'object') {
        return null;
    }

    const data = message.data;
    if (!data || typeof data !== 'object') {
        // Some messages have properties directly at top level
        if (message.properties) {
            return {
                type: 'status',
                data: parseStatusProperties(message.properties),
            };
        }
        return null;
    }

    // Handle list-style responses (getAllPorts)
    if (Array.isArray(data)) {
        return {
            type: 'ports',
            data: data.map((p) => p.portName).filter(Boolean),
        };
    }

    const portName = data.portName;
    const properties = data.properties || {};

    if (portName === PORT_STATUS || (!portName && Object.keys(properties).length > 0)) {
        return {
            type: 'status',
            data: parseStatusProperties(properties),
        };
    }

    if (portName === PORT_FILTER_READ) {
        return {
            type: 'filter',
            data: parseFilterProperties(properties),
        };
    }

    if (portName === PORT_CONFIG) {
        return {
            type: 'config',
            data: parseConfigProperties(properties),
        };
    }

    // Unknown port type - return raw properties
    return {
        type: portName || 'unknown',
        data: properties,
    };
}

/**
 * Parse status properties into normalized format.
 * Different device models may use different property names.
 * @param {object} props - Raw properties
 * @returns {object} Normalized status
 */
function parseStatusProperties(props) {
    const status = {
        raw: props,
    };

    // Power state (various property names)
    if ('pwr' in props) {
        status.power = props.pwr === '1' || props.pwr === 1 || props.pwr === true;
    } else if ('D03-02' in props) {
        status.power = props['D03-02'] === '1' || props['D03-02'] === 1;
    }

    // Mode (A=auto, S=sleep, T=turbo, M=manual)
    if ('mode' in props) {
        status.mode = MODE_NAMES[props.mode] || props.mode;
        status.modeRaw = props.mode;
    } else if ('D03-03' in props) {
        status.mode = MODE_NAMES[props['D03-03']] || props['D03-03'];
        status.modeRaw = props['D03-03'];
    }

    // Fan speed (1-18 typically)
    if ('om' in props) {
        status.fanSpeed = parseInt(props.om, 10) || 0;
    } else if ('D03-12' in props) {
        status.fanSpeed = parseInt(props['D03-12'], 10) || 0;
    }

    // PM2.5 (particulate matter)
    if ('pm25' in props) {
        status.pm25 = parseInt(props.pm25, 10);
    } else if ('D03-32' in props) {
        status.pm25 = parseInt(props['D03-32'], 10);
    }

    // Humidity
    if ('rh' in props) {
        status.humidity = parseInt(props.rh, 10);
    } else if ('D03-42' in props) {
        status.humidity = parseInt(props['D03-42'], 10);
    }

    // Temperature
    if ('temp' in props) {
        status.temperature = parseInt(props.temp, 10);
    } else if ('D03-41' in props) {
        status.temperature = parseInt(props['D03-41'], 10);
    }

    // Target humidity (for humidifiers)
    if ('rhset' in props) {
        status.targetHumidity = parseInt(props.rhset, 10);
    }

    // Water level (for humidifiers)
    if ('wl' in props) {
        status.waterLevel = parseInt(props.wl, 10);
    }

    // Air quality index
    if ('iaql' in props) {
        status.airQualityIndex = parseInt(props.iaql, 10);
    }

    // Child lock
    if ('cl' in props) {
        status.childLock = props.cl === '1' || props.cl === 1 || props.cl === true;
    }

    // Light/display brightness
    if ('uil' in props) {
        status.displayLight = parseInt(props.uil, 10);
    }

    return status;
}

/**
 * Parse filter properties.
 * @param {object} props - Raw properties
 * @returns {object} Filter status
 */
function parseFilterProperties(props) {
    const filter = {
        raw: props,
    };

    // Filter cleaning countdown (hours)
    if ('fltsts0' in props) {
        filter.cleanRemaining = parseInt(props.fltsts0, 10);
    }
    if ('fltt0' in props) {
        filter.cleanNominal = parseInt(props.fltt0, 10);
    }

    // Filter replacement countdown (hours)
    if ('fltsts1' in props) {
        filter.replaceRemaining = parseInt(props.fltsts1, 10);
    }
    if ('fltt1' in props) {
        filter.replaceNominal = parseInt(props.fltt1, 10);
    }

    // Calculate percentages
    if (filter.cleanNominal && filter.cleanRemaining !== undefined) {
        filter.cleanPercent = Math.round(
            (filter.cleanRemaining / filter.cleanNominal) * 100
        );
    }
    if (filter.replaceNominal && filter.replaceRemaining !== undefined) {
        filter.replacePercent = Math.round(
            (filter.replaceRemaining / filter.replaceNominal) * 100
        );
    }

    // Alert flag
    filter.needsCleaning = filter.cleanPercent !== undefined && filter.cleanPercent <= 5;
    filter.needsReplacement =
        filter.replacePercent !== undefined && filter.replacePercent <= 5;

    return filter;
}

/**
 * Parse config properties.
 * @param {object} props - Raw properties
 * @returns {object} Config data
 */
function parseConfigProperties(props) {
    const config = {
        raw: props,
    };

    // Device model
    if ('ctn' in props) {
        config.model = props.ctn;
    }

    // Firmware version
    if ('swversion' in props) {
        config.firmwareVersion = props.swversion;
    }

    // Device name
    if ('name' in props) {
        config.deviceName = props.name;
    }

    return config;
}

/**
 * Merge multiple status updates into one.
 * @param {object} existing - Existing status
 * @param {object} update - New status update
 * @returns {object} Merged status
 */
function mergeStatus(existing, update) {
    const merged = { ...existing };

    for (const [key, value] of Object.entries(update)) {
        if (key === 'raw') {
            merged.raw = { ...existing.raw, ...update.raw };
        } else if (value !== undefined) {
            merged[key] = value;
        }
    }

    merged.timestamp = Date.now();
    return merged;
}

module.exports = {
    parseMessage,
    parseStatusProperties,
    parseFilterProperties,
    parseConfigProperties,
    mergeStatus,
};
