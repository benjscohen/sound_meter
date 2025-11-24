const { calculateSize, calculateColor, CONSTANTS } = require('./audio-visualizer');

describe('Audio Visualizer Logic', () => {
    describe('calculateSize', () => {
        test('should return minimum size when volume is 0', () => {
            expect(calculateSize(0)).toBe(CONSTANTS.MIN_SIZE);
        });

        test('should return maximum size when volume is at sensitivity max', () => {
            expect(calculateSize(CONSTANTS.SENSITIVITY_MAX)).toBe(CONSTANTS.MIN_SIZE + CONSTANTS.MAX_ADDITIONAL_SIZE);
        });

        test('should cap size at maximum even if volume exceeds sensitivity max', () => {
            expect(calculateSize(CONSTANTS.SENSITIVITY_MAX + 50)).toBe(CONSTANTS.MIN_SIZE + CONSTANTS.MAX_ADDITIONAL_SIZE);
        });

        test('should return intermediate size for intermediate volume', () => {
            const midVol = CONSTANTS.SENSITIVITY_MAX / 2;
            const expectedSize = CONSTANTS.MIN_SIZE + (CONSTANTS.MAX_ADDITIONAL_SIZE / 2);
            expect(calculateSize(midVol)).toBe(expectedSize);
        });
    });

    describe('calculateColor', () => {
        test('should be pure green when volume is 0', () => {
            const color = calculateColor(0);
            expect(color).toEqual({ r: 0, g: 255, b: 0 });
        });

        test('should be pure yellow when volume is at yellow point', () => {
            const color = calculateColor(CONSTANTS.YELLOW_POINT);
            expect(color).toEqual({ r: 255, g: 255, b: 0 });
        });

        test('should be pure red when volume is at sensitivity max', () => {
            const color = calculateColor(CONSTANTS.SENSITIVITY_MAX);
            expect(color).toEqual({ r: 255, g: 0, b: 0 });
        });

        test('should transition from green to yellow', () => {
            const midVol = CONSTANTS.YELLOW_POINT / 2;
            const color = calculateColor(midVol);
            // R should be half way to 255, G should be 255, B should be 0
            expect(color.r).toBeGreaterThan(0);
            expect(color.r).toBeLessThan(255);
            expect(color.g).toBe(255);
            expect(color.b).toBe(0);
        });

        test('should transition from yellow to red', () => {
            const midVol = CONSTANTS.YELLOW_POINT + ((CONSTANTS.SENSITIVITY_MAX - CONSTANTS.YELLOW_POINT) / 2);
            const color = calculateColor(midVol);
            // R should be 255, G should be less than 255, B should be 0
            expect(color.r).toBe(255);
            expect(color.g).toBeLessThan(255);
            expect(color.g).toBeGreaterThan(0);
            expect(color.b).toBe(0);
        });
    });
});
