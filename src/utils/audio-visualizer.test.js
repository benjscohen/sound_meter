const {
    calculateSize,
    calculateColor,
    colorForRatio,
    levelRatio,
    zoneForRatio,
    smoothLevel,
    averageLevel,
    CONSTANTS
} = require('./audio-visualizer');

describe('Audio Visualizer Logic', () => {
    const { SENSITIVITY_PRESETS, SENSITIVITY_OPTIONS, MIN_SIZE, MAX_ADDITIONAL_SIZE, COLORS, MAX_RATIO } = CONSTANTS;

    describe('calculateSize', () => {
        test('returns minimum size when volume is 0', () => {
            expect(calculateSize(0)).toBe(MIN_SIZE);
        });

        test('returns maximum size at the default sensitivity max', () => {
            expect(calculateSize(SENSITIVITY_PRESETS.MEDIUM)).toBe(MIN_SIZE + MAX_ADDITIONAL_SIZE);
        });

        test('never exceeds maximum size', () => {
            expect(calculateSize(255, SENSITIVITY_PRESETS.HIGH)).toBe(MIN_SIZE + MAX_ADDITIONAL_SIZE);
        });

        test('adjusts max size threshold based on sensitivity', () => {
            expect(calculateSize(70, SENSITIVITY_PRESETS.HIGH)).toBe(MIN_SIZE + MAX_ADDITIONAL_SIZE);
            expect(calculateSize(70, SENSITIVITY_PRESETS.LOW))
                .toBeLessThan(calculateSize(70, SENSITIVITY_PRESETS.HIGH));
        });
    });

    describe('calculateColor', () => {
        test('is green when silent', () => {
            expect(calculateColor(0)).toEqual(COLORS.GREEN);
        });

        test('is red at the sensitivity max and beyond', () => {
            expect(calculateColor(SENSITIVITY_PRESETS.MEDIUM)).toEqual(COLORS.RED);
            expect(calculateColor(255, SENSITIVITY_PRESETS.HIGH)).toEqual(COLORS.RED);
        });

        test('is amber at the yellow point', () => {
            expect(calculateColor(60, SENSITIVITY_PRESETS.MEDIUM)).toEqual(COLORS.AMBER);
        });

        test('shifts thresholds with sensitivity', () => {
            expect(calculateColor(70, SENSITIVITY_PRESETS.HIGH)).toEqual(COLORS.RED);
            const low = calculateColor(70, SENSITIVITY_PRESETS.LOW);
            expect(low).not.toEqual(COLORS.RED);
            expect(low.g).toBeGreaterThan(COLORS.RED.g);
        });

        test('always returns valid channel values', () => {
            for (const ratio of [-1, 0, 0.2, 0.43, 0.7, 1, 4]) {
                const { r, g, b } = colorForRatio(ratio);
                for (const channel of [r, g, b]) {
                    expect(Number.isInteger(channel)).toBe(true);
                    expect(channel).toBeGreaterThanOrEqual(0);
                    expect(channel).toBeLessThanOrEqual(255);
                }
            }
        });
    });

    describe('levelRatio', () => {
        test('is clamped and safe for bad input', () => {
            expect(levelRatio(0)).toBe(0);
            expect(levelRatio(NaN)).toBe(0);
            expect(levelRatio(50, 0)).toBe(0);
            expect(levelRatio(10000, SENSITIVITY_PRESETS.HIGH)).toBe(MAX_RATIO);
            expect(levelRatio(70, SENSITIVITY_PRESETS.MEDIUM)).toBeCloseTo(0.5);
        });
    });

    describe('zoneForRatio', () => {
        test('maps ratios to zones', () => {
            expect(zoneForRatio(0)).toBe('good');
            expect(zoneForRatio(0.3)).toBe('good');
            expect(zoneForRatio(0.5)).toBe('elevated');
            expect(zoneForRatio(0.75)).toBe('loud');
            expect(zoneForRatio(1.4)).toBe('loud');
        });
    });

    describe('smoothLevel', () => {
        test('rises faster than it falls', () => {
            const up = smoothLevel(0, 100) - 0;
            const down = 100 - smoothLevel(100, 0);
            expect(up).toBeGreaterThan(down);
        });

        test('converges on a steady input', () => {
            let level = 0;
            for (let i = 0; i < 200; i++) level = smoothLevel(level, 80);
            expect(level).toBeCloseTo(80, 3);
        });
    });

    describe('averageLevel', () => {
        test('averages byte data and tolerates empties', () => {
            expect(averageLevel(new Uint8Array([0, 100, 200]))).toBe(100);
            expect(averageLevel(new Uint8Array(0))).toBe(0);
            expect(averageLevel(null)).toBe(0);
        });
    });

    test('sensitivity options cover every preset exactly once', () => {
        const values = SENSITIVITY_OPTIONS.map(o => o.value).sort((a, b) => a - b);
        expect(values).toEqual(Object.values(SENSITIVITY_PRESETS).sort((a, b) => a - b));
    });
});
