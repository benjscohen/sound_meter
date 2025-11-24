/**
 * Calculates the visual properties (size and color) for the sound meter based on audio volume.
 */

const SENSITIVITY_MAX = 140;
const YELLOW_POINT = 60;
const MIN_SIZE = 50;
const MAX_ADDITIONAL_SIZE = 100;

/**
 * Calculates the diameter of the circle based on volume average.
 * @param {number} average - The average volume (0-255)
 * @returns {number} The calculated size in pixels
 */
function calculateSize(average) {
    return MIN_SIZE + Math.min(average / SENSITIVITY_MAX, 1) * MAX_ADDITIONAL_SIZE;
}

/**
 * Calculates the RGB color based on volume average.
 * Green (low) -> Yellow (medium) -> Red (high)
 * @param {number} average - The average volume (0-255)
 * @returns {Object} Object containing r, g, b values
 */
function calculateColor(average) {
    let r, g, b;

    if (average < YELLOW_POINT) {
        // Green to Yellow
        r = Math.floor((average / YELLOW_POINT) * 255);
        g = 255;
        b = 0;
    } else {
        // Yellow to Red
        // Clamp average to sensitivityMax for color calculation
        const clampedAvg = Math.min(average, SENSITIVITY_MAX);
        const range = SENSITIVITY_MAX - YELLOW_POINT;
        const progress = (clampedAvg - YELLOW_POINT) / range;

        r = 255;
        g = Math.floor(255 - (progress * 255));
        b = 0;
    }

    return { r, g, b };
}

module.exports = {
    calculateSize,
    calculateColor,
    CONSTANTS: {
        SENSITIVITY_MAX,
        YELLOW_POINT,
        MIN_SIZE,
        MAX_ADDITIONAL_SIZE
    }
};
