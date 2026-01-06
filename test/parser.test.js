/**
 * Tests for AWS IoT Shadow parser module.
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
                        powerOn: true,
                        mode: 'A',
                        pm25: '15',
                    },
                    desired: {
                        powerOn: true,
                    },
                },
                timestamp: 1767673935,
                version: 123,
            };

            const result = parseShadow(shadow);

            expect(result.reported.power).toBe(true);
            expect(result.reported.mode).toBe('auto');
            expect(result.reported.pm25).toBe(15);
            expect(result.desired.powerOn).toBe(true);
            expect(result.timestamp).toBe(1767673935);
            expect(result.version).toBe(123);
        });

        it('handles shadow without desired state', () => {
            const shadow = {
                state: {
                    reported: { powerOn: false },
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
            expect(parseReportedState({ powerOn: true }).power).toBe(true);
            expect(parseReportedState({ powerOn: false }).power).toBe(false);
            expect(parseReportedState({ pwr: '1' }).power).toBe(true);
            expect(parseReportedState({ pwr: '0' }).power).toBe(false);
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
            expect(parseReportedState({ mode: 'A' }).mode).toBe('auto');
            expect(parseReportedState({ mode: 'S' }).mode).toBe('sleep');
            expect(parseReportedState({ mode: 'T' }).mode).toBe('turbo');
            expect(parseReportedState({ mode: 'M' }).mode).toBe('manual');
        });

        it('preserves raw mode value', () => {
            const result = parseReportedState({ mode: 'A' });
            expect(result.modeRaw).toBe('A');
        });

        it('parses fan speed', () => {
            expect(parseReportedState({ om: '12' }).fanSpeed).toBe(12);
            expect(parseReportedState({ fanSpeed: 8 }).fanSpeed).toBe(8);
        });

        it('parses PM2.5', () => {
            expect(parseReportedState({ pm25: '15' }).pm25).toBe(15);
            expect(parseReportedState({ pm25: 20 }).pm25).toBe(20);
        });

        it('parses humidity', () => {
            expect(parseReportedState({ rh: '45' }).humidity).toBe(45);
            expect(parseReportedState({ humidity: 50 }).humidity).toBe(50);
        });

        it('parses temperature', () => {
            expect(parseReportedState({ temp: '22' }).temperature).toBe(22);
            expect(parseReportedState({ temperature: 25 }).temperature).toBe(25);
        });

        it('parses humidifier properties', () => {
            const result = parseReportedState({
                rhset: '50',
                wl: '80',
            });
            expect(result.targetHumidity).toBe(50);
            expect(result.waterLevel).toBe(80);
        });

        it('parses air quality index', () => {
            expect(parseReportedState({ iaql: '3' }).airQualityIndex).toBe(3);
            expect(parseReportedState({ airQualityIndex: 5 }).airQualityIndex).toBe(5);
        });

        it('parses child lock', () => {
            expect(parseReportedState({ cl: '1' }).childLock).toBe(true);
            expect(parseReportedState({ cl: '0' }).childLock).toBe(false);
            expect(parseReportedState({ childLock: true }).childLock).toBe(true);
        });

        it('parses display light', () => {
            expect(parseReportedState({ uil: '100' }).displayLight).toBe(100);
            expect(parseReportedState({ displayLight: 50 }).displayLight).toBe(50);
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

        it('parses filter status', () => {
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
            const props = { powerOn: true, unknown: 'value' };
            const result = parseReportedState(props);
            expect(result.raw).toBe(props);
        });
    });

    describe('buildDesiredState', () => {
        it('builds power state', () => {
            expect(buildDesiredState({ power: true })).toEqual({ powerOn: true });
            expect(buildDesiredState({ power: false })).toEqual({ powerOn: false });
        });

        it('builds mode state', () => {
            expect(buildDesiredState({ mode: 'auto' })).toEqual({ mode: 'A' });
            expect(buildDesiredState({ mode: 'sleep' })).toEqual({ mode: 'S' });
            expect(buildDesiredState({ mode: 'turbo' })).toEqual({ mode: 'T' });
            expect(buildDesiredState({ mode: 'manual' })).toEqual({ mode: 'M' });
        });

        it('passes through raw mode codes', () => {
            expect(buildDesiredState({ mode: 'A' })).toEqual({ mode: 'A' });
        });

        it('builds fan speed state', () => {
            expect(buildDesiredState({ fanSpeed: 12 })).toEqual({ om: '12' });
        });

        it('builds target humidity state', () => {
            expect(buildDesiredState({ targetHumidity: 50 })).toEqual({ rhset: '50' });
        });

        it('builds child lock state', () => {
            expect(buildDesiredState({ childLock: true })).toEqual({ cl: '1' });
            expect(buildDesiredState({ childLock: false })).toEqual({ cl: '0' });
        });

        it('builds display light state', () => {
            expect(buildDesiredState({ displayLight: 2 })).toEqual({ uil: '2' });
        });

        it('builds combined state', () => {
            const result = buildDesiredState({
                power: true,
                mode: 'auto',
                fanSpeed: 8,
            });

            expect(result).toEqual({
                powerOn: true,
                mode: 'A',
                om: '8',
            });
        });

        it('ignores undefined values', () => {
            const result = buildDesiredState({
                power: true,
                mode: undefined,
            });

            expect(result).toEqual({ powerOn: true });
            expect(result).not.toHaveProperty('mode');
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
            const existing = { raw: { pwr: '1' } };
            const update = { raw: { pm25: '15' } };

            const result = mergeStatus(existing, update);

            expect(result.raw.pwr).toBe('1');
            expect(result.raw.pm25).toBe('15');
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
