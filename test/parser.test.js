/**
 * Tests for AWS IoT Shadow parser module.
 * V3 protocol only - uses DID codes (D03102, D0310C, etc.)
 */

const {
  parseShadow,
  parseReportedState,
  buildDesiredState,
  mergeStatus,
} = require('../lib/parser');

describe('parser', () => {
  describe('parseShadow', () => {
    it('parses complete shadow document', () => {
      const shadow = {
        state: {
          reported: {
            D03102: 1,
            D0310C: 0,
            D03221: '15',
          },
          desired: {
            D03102: 1,
          },
        },
        timestamp: 1767673935,
        version: 123,
      };

      const result = parseShadow(shadow);

      expect(result.reported.power).toBe(true);
      expect(result.reported.mode).toBe('auto');
      expect(result.reported.pm25).toBe(15);
      expect(result.desired.D03102).toBe(1);
      expect(result.timestamp).toBe(1767673935);
      expect(result.version).toBe(123);
    });

    it('handles shadow without desired state', () => {
      const shadow = {
        state: {
          reported: { D03102: 0 },
        },
      };

      const result = parseShadow(shadow);

      expect(result.reported.power).toBe(false);
      expect(result.desired).toEqual({});
    });

    it('returns null for invalid input', () => {
      expect(parseShadow(null)).toBeNull();
      expect(parseShadow({})).toEqual({
        reported: {},
        desired: {},
        timestamp: undefined,
        version: undefined,
      });
    });
  });

  describe('parseReportedState', () => {
    it('parses power state', () => {
      expect(parseReportedState({ D03102: 1 }).power).toBe(true);
      expect(parseReportedState({ D03102: 0 }).power).toBe(false);
    });

    it('parses connected state', () => {
      expect(parseReportedState({ connected: true }).connected).toBe(true);
      expect(parseReportedState({ connected: false }).connected).toBe(false);
    });

    it('parses product state', () => {
      const result = parseReportedState({ productState: 'running' });
      expect(result.productState).toBe('running');
    });

    it('parses mode', () => {
      expect(parseReportedState({ D0310C: 0 }).mode).toBe('auto');
      expect(parseReportedState({ D0310C: 17 }).mode).toBe('sleep');
      expect(parseReportedState({ D0310C: 18 }).mode).toBe('turbo');
    });

    it('parses manual mode with fan speed', () => {
      const result = parseReportedState({ D0310C: 12 });
      expect(result.mode).toBe('manual');
      expect(result.fanSpeed).toBe(12);
    });

    it('preserves raw mode value', () => {
      const result = parseReportedState({ D0310C: 0 });
      expect(result.modeRaw).toBe(0);
    });

    it('parses PM2.5', () => {
      expect(parseReportedState({ D03221: '15' }).pm25).toBe(15);
      expect(parseReportedState({ D03221: 20 }).pm25).toBe(20);
    });

    it('parses humidity', () => {
      expect(parseReportedState({ D03125: '45' }).humidity).toBe(45);
    });

    it('parses temperature (divides by 10)', () => {
      expect(parseReportedState({ D03224: '220' }).temperature).toBe(22);
      expect(parseReportedState({ D03224: '250' }).temperature).toBe(25);
    });

    it('parses target humidity', () => {
      expect(parseReportedState({ D03128: '50' }).targetHumidity).toBe(50);
    });

    it('parses air quality index', () => {
      expect(parseReportedState({ D03120: '3' }).airQualityIndex).toBe(3);
    });

    it('parses child lock', () => {
      expect(parseReportedState({ D03103: 1 }).childLock).toBe(true);
      expect(parseReportedState({ D03103: 0 }).childLock).toBe(false);
    });

    it('parses display light', () => {
      expect(parseReportedState({ D03105: '100' }).displayLight).toBe(100);
    });

    it('parses firmware versions', () => {
      const result = parseReportedState({
        ncpFirmwareVersion: '1.0.0',
        hostFirmwareVersion: '1.0.4',
      });
      expect(result.ncpFirmwareVersion).toBe('1.0.0');
      expect(result.hostFirmwareVersion).toBe('1.0.4');
    });

    it('parses timezone', () => {
      const result = parseReportedState({
        timezones: {
          iana: 'Europe/Warsaw',
          posix: 'CET-1CEST,M3.5.0,M10.5.0/3',
        },
      });
      expect(result.timezone).toBe('Europe/Warsaw');
    });

    it('parses filter status (v1 fields)', () => {
      const result = parseReportedState({
        fltsts0: '200',
        fltt0: '360',
        fltsts1: '2400',
        fltt1: '4800',
      });

      expect(result.filter.cleanRemaining).toBe(200);
      expect(result.filter.cleanNominal).toBe(360);
      expect(result.filter.replaceRemaining).toBe(2400);
      expect(result.filter.replaceNominal).toBe(4800);
      expect(result.filter.cleanPercent).toBe(56);
      expect(result.filter.replacePercent).toBe(50);
    });

    it('preserves raw properties', () => {
      const props = { D03102: 1, unknown: 'value' };
      const result = parseReportedState(props);
      expect(result.raw).toBe(props);
    });
  });

  describe('buildDesiredState', () => {
    it('builds power state', () => {
      expect(buildDesiredState({ power: true })).toEqual({ D03102: 1 });
      expect(buildDesiredState({ power: false })).toEqual({ D03102: 0 });
    });

    it('builds mode state', () => {
      expect(buildDesiredState({ mode: 'auto' })).toEqual({ D0310C: 0 });
      expect(buildDesiredState({ mode: 'sleep' })).toEqual({ D0310C: 17 });
      expect(buildDesiredState({ mode: 'turbo' })).toEqual({ D0310C: 18 });
    });

    it('builds fan speed state (clamped to AC3737 max)', () => {
      expect(buildDesiredState({ fanSpeed: 2 })).toEqual({ D0310C: 2 });
      // AC3737 max fan speed is 2 - higher values get clamped
      expect(buildDesiredState({ fanSpeed: 12 })).toEqual({ D0310C: 2 });
    });

    it('builds target humidity state', () => {
      expect(buildDesiredState({ targetHumidity: 50 })).toEqual({ D03128: 50 });
    });

    it('builds child lock state', () => {
      expect(buildDesiredState({ childLock: true })).toEqual({ D03103: 1 });
      expect(buildDesiredState({ childLock: false })).toEqual({ D03103: 0 });
    });

    it('builds display light state', () => {
      expect(buildDesiredState({ displayLight: 2 })).toEqual({ D03105: 2 });
    });

    it('builds combined state', () => {
      const result = buildDesiredState({
        power: true,
        mode: 'auto',
      });

      expect(result).toEqual({
        D03102: 1,
        D0310C: 0,
      });
    });

    it('ignores undefined values', () => {
      const result = buildDesiredState({
        power: true,
        mode: undefined,
      });

      expect(result).toEqual({ D03102: 1 });
      expect(result).not.toHaveProperty('D0310C');
    });
  });

  describe('mergeStatus', () => {
    it('merges new properties into existing', () => {
      const existing = { power: true, fanSpeed: 8 };
      const update = { pm25: 15 };

      const result = mergeStatus(existing, update);

      expect(result.power).toBe(true);
      expect(result.fanSpeed).toBe(8);
      expect(result.pm25).toBe(15);
    });

    it('overwrites existing properties', () => {
      const existing = { fanSpeed: 8 };
      const update = { fanSpeed: 12 };

      const result = mergeStatus(existing, update);

      expect(result.fanSpeed).toBe(12);
    });

    it('merges raw properties', () => {
      const existing = { raw: { D03102: 1 } };
      const update = { raw: { D03221: '15' } };

      const result = mergeStatus(existing, update);

      expect(result.raw.D03102).toBe(1);
      expect(result.raw.D03221).toBe('15');
    });

    it('merges filter properties', () => {
      const existing = { filter: { cleanRemaining: 200 } };
      const update = { filter: { replaceRemaining: 2400 } };

      const result = mergeStatus(existing, update);

      expect(result.filter.cleanRemaining).toBe(200);
      expect(result.filter.replaceRemaining).toBe(2400);
    });

    it('adds timestamp', () => {
      const before = Date.now();
      const result = mergeStatus({}, {});
      const after = Date.now();

      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });

    it('ignores undefined values', () => {
      const existing = { power: true };
      const update = { power: undefined, fanSpeed: 8 };

      const result = mergeStatus(existing, update);

      expect(result.power).toBe(true);
      expect(result.fanSpeed).toBe(8);
    });
  });
});
