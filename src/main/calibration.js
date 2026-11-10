const { CONSTANTS } = require('../utils/audio-visualizer');

const PRESETS = Object.values(CONSTANTS.SENSITIVITY_PRESETS);

/**
 * Learns a person's normal speaking level, once, and turns it into a
 * sensitivity (the level that counts as "too loud").
 *
 * It is fed one raw microphone level per second (0-255, the same scale the
 * meter draws from). Seconds that stand clearly above the room's background
 * are treated as speech; once there are enough of them, the typical speech
 * level is placed comfortably in the green and learning stops. It never
 * keeps adjusting, so someone who gets louder over time isn't quietly
 * forgiven for it.
 */
function createCalibrator({
    speechSeconds = 45,     // How much talking it needs to hear
    window = 600,           // Seconds of history to consider
    target = 0.38,          // Where normal speech should sit, as a share of the limit
    min = Math.min(...PRESETS),
    max = Math.max(...PRESETS)
} = {}) {
    let seconds = [];

    const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

    function speech() {
        if (seconds.length < 10) return [];
        const sorted = [...seconds].sort((a, b) => a - b);
        // The quietest tenth is the room; speech is well above it.
        const threshold = percentile(sorted, 0.1) * 1.8 + 3;
        return sorted.filter((level) => level >= threshold);
    }

    return {
        /** Adds a second; returns the learned sensitivity once ready, else null. */
        add(raw) {
            if (!Number.isFinite(raw) || raw < 0) return null;
            seconds.push(raw);
            if (seconds.length > window) seconds.shift();

            const spoken = speech();
            if (spoken.length < speechSeconds) return null;
            const typical = percentile(spoken, 0.5);
            return Math.round(Math.min(max, Math.max(min, typical / target)));
        },
        /** 0 to 1: how much of the talking it needs has been heard. */
        progress: () => Math.min(1, speech().length / speechSeconds),
        reset() {
            seconds = [];
        }
    };
}

module.exports = { createCalibrator };
