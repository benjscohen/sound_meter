const { calculateSize, calculateColor, CONSTANTS } = require('./audio-visualizer');

describe('Audio Visualizer Logic', () => {
    const { SENSITIVITY_PRESETS, MIN_SIZE, MAX_ADDITIONAL_SIZE } = CONSTANTS;

    describe('calculateSize', () => {
        test('should return minimum size when volume is 0', () => {
            expect(calculateSize(0)).toBe(MIN_SIZE);
        });

        test('should return maximum size when volume is at default sensitivity max', () => {
            expect(calculateSize(SENSITIVITY_PRESETS.MEDIUM)).toBe(MIN_SIZE + MAX_ADDITIONAL_SIZE);
        });

        test('should adjust max size threshold based on sensitivity', () => {
            // At HIGH sensitivity (70), volume 70 should be max size
            expect(calculateSize(70, SENSITIVITY_PRESETS.HIGH)).toBe(MIN_SIZE + MAX_ADDITIONAL_SIZE);

            // At LOW sensitivity (210), volume 70 should be smaller
            const lowSensSize = calculateSize(70, SENSITIVITY_PRESETS.LOW);
            const highSensSize = calculateSize(70, SENSITIVITY_PRESETS.HIGH);
            expect(lowSensSize).toBeLessThan(highSensSize);
        });
    });

    describe('calculateColor', () => {
        test('should be pure green when volume is 0', () => {
            const color = calculateColor(0);
            expect(color).toEqual({ r: 0, g: 255, b: 0 });
        });

        test('should be pure red when volume is at sensitivity max', () => {
            const color = calculateColor(SENSITIVITY_PRESETS.MEDIUM);
            expect(color).toEqual({ r: 255, g: 0, b: 0 });
        });

        test('should adjust color thresholds based on sensitivity', () => {
            // At HIGH sensitivity (70), volume 70 is RED
            const highSensColor = calculateColor(70, SENSITIVITY_PRESETS.HIGH);
            expect(highSensColor).toEqual({ r: 255, g: 0, b: 0 });

            // At LOW sensitivity (210), volume 70 is likely GREEN-YELLOW (not red)
            const lowSensColor = calculateColor(70, SENSITIVITY_PRESETS.LOW);
            expect(lowSensColor.r).toBeLessThan(255); // Not fully red
            expect(lowSensColor.g).toBe(255); // Still fully green (yellowish)
        });
    });
});
