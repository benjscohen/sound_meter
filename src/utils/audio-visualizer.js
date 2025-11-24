/**
 * Calculates the visual properties (size and color) for the sound meter based on audio volume.
 */

const SENSITIVITY_PRESETS = {
    HIGH: 70,   // Reacts to quiet sounds
    MEDIUM: 140, // Default
    LOW: 210    // Requires loud sounds
};

const YELLOW_POINT_RATIO = 60 / 140; // Ratio of yellow point to max sensitivity
const MIN_SIZE = 50;
const MAX_ADDITIONAL_SIZE = 100;

/**
 * Calculates the diameter of the circle based on volume average.
 * @param {number} average - The average volume (0-255)
 * @param {number} sensitivityMax - The volume level considered "max" (red/largest)
 * @returns {number} The calculated size in pixels
 */
function calculateSize(average, sensitivityMax = SENSITIVITY_PRESETS.MEDIUM) {
    return MIN_SIZE + Math.min(average / sensitivityMax, 1) * MAX_ADDITIONAL_SIZE;
}

/**
 * Calculates the RGB color based on volume average.
 * Green (low) -> Yellow (medium) -> Red (high)
 * @param {number} average - The average volume (0-255)
 * @param {number} sensitivityMax - The volume level considered "max" (red/largest)
 * @returns {Object} Object containing r, g, b values
 */
function calculateColor(average, sensitivityMax = SENSITIVITY_PRESETS.MEDIUM) {
    let r, g, b;

    // Calculate dynamic yellow point based on sensitivity
    const yellowPoint = sensitivityMax * YELLOW_POINT_RATIO;

    if (average < yellowPoint) {
        // Green to Yellow
        r = Math.floor((average / yellowPoint) * 255);
        g = 255;
        b = 0;
    } else {
        // Yellow to Red
        // Clamp average to sensitivityMax for color calculation
        const clampedAvg = Math.min(average, sensitivityMax);
        const range = sensitivityMax - yellowPoint;
        const progress = (clampedAvg - yellowPoint) / range;

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
        SENSITIVITY_PRESETS,
        MIN_SIZE,
        MAX_ADDITIONAL_SIZE
    }
};
