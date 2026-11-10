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
    speechSeconds = 20,     // How much talking it needs to hear
    window = 600,           // Seconds of history to consider
    target = 0.38,          // Where normal speech should sit, as a share of the limit
    minSpeech = 18,         // Nothing quieter than this counts as speech, however silent the room
    minTypical = 24,        // A "voice" quieter than this is more likely typing or a fan
    min = Math.min(...PRESETS),
    max = Math.max(...PRESETS)
} = {}) {
    let seconds = [];

    const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

    function speech() {
        if (seconds.length < 10) return [];
        const sorted = [...seconds].sort((a, b) => a - b);
        // The quietest tenth is the room; anything clearly above it is sound.
        const threshold = Math.max(minSpeech, percentile(sorted, 0.1) * 1.8 + 3);
        const sounds = sorted.filter((level) => level >= threshold);
        if (!sounds.length) return [];
        // Of those sounds, the voice at the microphone is the loud end.
        // Quieter ones (typing, voices from the speakers, half-spoken
        // seconds) are left out so they can't drag the estimate down.
        const cutoff = percentile(sounds, 0.9) * 0.6;
        return sounds.filter((level) => level >= cutoff);
    }

    return {
        /** Adds a second; returns the learned sensitivity once ready, else null. */
        add(raw) {
            if (!Number.isFinite(raw) || raw < 0) return null;
            seconds.push(raw);
            if (seconds.length > window) seconds.shift();

            const spoken = speech();
            if (spoken.length < speechSeconds) return null;
            // The upper part of what was heard: many "speech" seconds are only
            // partly spoken (or are a voice from the speakers), which reads
            // quieter than the person actually talks. Checked against a real
            // recording of levels, this lands near the hand-picked default.
            const typical = percentile(spoken, 0.75);
            if (typical < minTypical) return null; // Implausible for a voice: keep listening
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
