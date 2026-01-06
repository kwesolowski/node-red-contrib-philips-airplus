const {
    parseMessage,
    parseStatusProperties,
    parseFilterProperties,
    parseConfigProperties,
    mergeStatus,
} = require('../lib/parser');

describe('parser', () => {
    describe('parseMessage', () => {
        it('parses status message with portName', () => {
            const msg = {
                cn: 'getPort',
                data: {
                    portName: 'Status',
                    properties: {
                        pwr: '1',
                        mode: 'A',
                        om: '8',
                    },
                },
            };

            const result = parseMessage(msg);

            expect(result.type).toBe('status');
            expect(result.data.power).toBe(true);
            expect(result.data.mode).toBe('auto');
            expect(result.data.fanSpeed).toBe(8);
        });

        it('parses filter message', () => {
            const msg = {
                data: {
                    portName: 'filtRd',
                    properties: {
                        fltsts0: '200',
                        fltt0: '360',
                        fltsts1: '2400',
                        fltt1: '4800',
                    },
                },
            };

            const result = parseMessage(msg);

            expect(result.type).toBe('filter');
            expect(result.data.cleanRemaining).toBe(200);
            expect(result.data.replaceRemaining).toBe(2400);
        });

        it('parses config message', () => {
            const msg = {
                data: {
                    portName: 'Config',
                    properties: {
                        ctn: 'AC3737/10',
                        swversion: '1.2.3',
                    },
                },
            };

            const result = parseMessage(msg);

            expect(result.type).toBe('config');
            expect(result.data.model).toBe('AC3737/10');
            expect(result.data.firmwareVersion).toBe('1.2.3');
        });

        it('handles message without portName but with properties', () => {
            const msg = {
                data: {
                    properties: {
                        pwr: '1',
                        pm25: '15',
                    },
                },
            };

            const result = parseMessage(msg);

            expect(result.type).toBe('status');
            expect(result.data.power).toBe(true);
            expect(result.data.pm25).toBe(15);
        });

        it('handles top-level properties', () => {
            const msg = {
                properties: {
                    pwr: '1',
                },
            };

            const result = parseMessage(msg);

            expect(result.type).toBe('status');
            expect(result.data.power).toBe(true);
        });

        it('handles getAllPorts list response', () => {
            const msg = {
                data: [
                    { portName: 'Status' },
                    { portName: 'Config' },
                    { portName: 'filtRd' },
                ],
            };

            const result = parseMessage(msg);

            expect(result.type).toBe('ports');
            expect(result.data).toEqual(['Status', 'Config', 'filtRd']);
        });

        it('returns null for invalid input', () => {
            expect(parseMessage(null)).toBeNull();
            expect(parseMessage({})).toBeNull();
            expect(parseMessage({ data: null })).toBeNull();
        });
    });

    describe('parseStatusProperties', () => {
        it('parses power state', () => {
            expect(parseStatusProperties({ pwr: '1' }).power).toBe(true);
            expect(parseStatusProperties({ pwr: '0' }).power).toBe(false);
            expect(parseStatusProperties({ pwr: 1 }).power).toBe(true);
            expect(parseStatusProperties({ pwr: true }).power).toBe(true);
        });

        it('parses alternative power property', () => {
            expect(parseStatusProperties({ 'D03-02': '1' }).power).toBe(true);
            expect(parseStatusProperties({ 'D03-02': 1 }).power).toBe(true);
        });

        it('parses mode', () => {
            expect(parseStatusProperties({ mode: 'A' }).mode).toBe('auto');
            expect(parseStatusProperties({ mode: 'S' }).mode).toBe('sleep');
            expect(parseStatusProperties({ mode: 'T' }).mode).toBe('turbo');
            expect(parseStatusProperties({ mode: 'M' }).mode).toBe('manual');
        });

        it('preserves raw mode value', () => {
            const result = parseStatusProperties({ mode: 'A' });
            expect(result.modeRaw).toBe('A');
        });

        it('parses fan speed', () => {
            expect(parseStatusProperties({ om: '12' }).fanSpeed).toBe(12);
            expect(parseStatusProperties({ om: 8 }).fanSpeed).toBe(8);
        });

        it('parses PM2.5', () => {
            expect(parseStatusProperties({ pm25: '15' }).pm25).toBe(15);
            expect(parseStatusProperties({ 'D03-32': 20 }).pm25).toBe(20);
        });

        it('parses humidity', () => {
            expect(parseStatusProperties({ rh: '45' }).humidity).toBe(45);
        });

        it('parses temperature', () => {
            expect(parseStatusProperties({ temp: '22' }).temperature).toBe(22);
        });

        it('parses humidifier properties', () => {
            const result = parseStatusProperties({
                rhset: '50',
                wl: '80',
            });
            expect(result.targetHumidity).toBe(50);
            expect(result.waterLevel).toBe(80);
        });

        it('parses air quality index', () => {
            expect(parseStatusProperties({ iaql: '3' }).airQualityIndex).toBe(3);
        });

        it('parses child lock', () => {
            expect(parseStatusProperties({ cl: '1' }).childLock).toBe(true);
            expect(parseStatusProperties({ cl: '0' }).childLock).toBe(false);
        });

        it('parses display light', () => {
            expect(parseStatusProperties({ uil: '100' }).displayLight).toBe(100);
        });

        it('preserves raw properties', () => {
            const props = { pwr: '1', unknown: 'value' };
            const result = parseStatusProperties(props);
            expect(result.raw).toBe(props);
        });
    });

    describe('parseFilterProperties', () => {
        it('parses filter cleaning status', () => {
            const result = parseFilterProperties({
                fltsts0: '200',
                fltt0: '360',
            });

            expect(result.cleanRemaining).toBe(200);
            expect(result.cleanNominal).toBe(360);
        });

        it('parses filter replacement status', () => {
            const result = parseFilterProperties({
                fltsts1: '2400',
                fltt1: '4800',
            });

            expect(result.replaceRemaining).toBe(2400);
            expect(result.replaceNominal).toBe(4800);
        });

        it('calculates percentages', () => {
            const result = parseFilterProperties({
                fltsts0: '180',
                fltt0: '360',
                fltsts1: '2400',
                fltt1: '4800',
            });

            expect(result.cleanPercent).toBe(50);
            expect(result.replacePercent).toBe(50);
        });

        it('sets alert flags when low', () => {
            const result = parseFilterProperties({
                fltsts0: '10',
                fltt0: '360',
                fltsts1: '100',
                fltt1: '4800',
            });

            expect(result.needsCleaning).toBe(true);
            expect(result.needsReplacement).toBe(true);
        });

        it('clears alert flags when healthy', () => {
            const result = parseFilterProperties({
                fltsts0: '300',
                fltt0: '360',
                fltsts1: '4000',
                fltt1: '4800',
            });

            expect(result.needsCleaning).toBe(false);
            expect(result.needsReplacement).toBe(false);
        });
    });

    describe('parseConfigProperties', () => {
        it('parses model', () => {
            const result = parseConfigProperties({ ctn: 'AC3737/10' });
            expect(result.model).toBe('AC3737/10');
        });

        it('parses firmware version', () => {
            const result = parseConfigProperties({ swversion: '2.1.0' });
            expect(result.firmwareVersion).toBe('2.1.0');
        });

        it('parses device name', () => {
            const result = parseConfigProperties({ name: 'Living Room' });
            expect(result.deviceName).toBe('Living Room');
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
