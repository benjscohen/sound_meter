/**
 * Pure maths for the sound meter: turns a raw volume reading into the orb's
 * size, colour and "zone". Loaded both by Node (tests, main process) and
 * directly by the renderer via a <script> tag (as window.AudioVisualizer).
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.AudioVisualizer = api;
    }
})(typeof self !== 'undefined' ? self : this, function () {
    // The volume (0-255 analyser average) that counts as "max" for each preset.
    const SENSITIVITY_PRESETS = {
        HIGH: 70,    // Reacts to quiet sounds
        MEDIUM: 140, // Default
        LOW: 210,    // Requires loud sounds
        VERY_LOW: 280,
        ULTRA_LOW: 350
    };

    // Menu-friendly description of each preset, most sensitive first.
    const SENSITIVITY_OPTIONS = [
        { value: SENSITIVITY_PRESETS.HIGH, label: 'High', hint: 'Quiet room, soft voice' },
        { value: SENSITIVITY_PRESETS.MEDIUM, label: 'Medium', hint: 'Most desks' },
        { value: SENSITIVITY_PRESETS.LOW, label: 'Low', hint: 'Open office' },
        { value: SENSITIVITY_PRESETS.VERY_LOW, label: 'Very Low', hint: 'Noisy space' },
        { value: SENSITIVITY_PRESETS.ULTRA_LOW, label: 'Ultra Low', hint: 'Hot mic or loud room' }
    ];

    const YELLOW_POINT_RATIO = 60 / 140; // Where green has fully turned amber
    const LOUD_RATIO = 0.75;             // Where we call it "too loud"
    const MAX_RATIO = 1.5;               // Clamp for stored/plotted values
    const MIN_SIZE = 50;
    const MAX_ADDITIONAL_SIZE = 100;

    const GREEN = { r: 48, g: 209, b: 88 };
    const AMBER = { r: 255, g: 204, b: 0 };
    const RED = { r: 255, g: 69, b: 58 };

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function mix(from, to, t) {
        return {
            r: Math.round(from.r + (to.r - from.r) * t),
            g: Math.round(from.g + (to.g - from.g) * t),
            b: Math.round(from.b + (to.b - from.b) * t)
        };
    }

    /** Volume as a fraction of the "too loud" point for this sensitivity. */
    function levelRatio(average, sensitivityMax = SENSITIVITY_PRESETS.MEDIUM) {
        if (!(sensitivityMax > 0) || !(average > 0)) return 0;
        return clamp(average / sensitivityMax, 0, MAX_RATIO);
    }

    /** Diameter of the orb in pixels. */
    function calculateSize(average, sensitivityMax = SENSITIVITY_PRESETS.MEDIUM) {
        return MIN_SIZE + Math.min(levelRatio(average, sensitivityMax), 1) * MAX_ADDITIONAL_SIZE;
    }

    /** Green → amber → red for a ratio in [0, 1]. */
    function colorForRatio(ratio) {
        const r = clamp(ratio, 0, 1);
        if (r < YELLOW_POINT_RATIO) {
            return mix(GREEN, AMBER, r / YELLOW_POINT_RATIO);
        }
        return mix(AMBER, RED, (r - YELLOW_POINT_RATIO) / (1 - YELLOW_POINT_RATIO));
    }

    function calculateColor(average, sensitivityMax = SENSITIVITY_PRESETS.MEDIUM) {
        return colorForRatio(levelRatio(average, sensitivityMax));
    }

    /** 'good' | 'elevated' | 'loud' */
    function zoneForRatio(ratio) {
        if (ratio >= LOUD_RATIO) return 'loud';
        if (ratio >= YELLOW_POINT_RATIO) return 'elevated';
        return 'good';
    }

    const ZONE_LABELS = {
        good: 'Sounding good',
        elevated: 'Getting loud',
        loud: 'Too loud'
    };

    /**
     * Envelope follower: rises quickly, falls slowly, so the orb feels alive
     * without jittering on every syllable.
     */
    function smoothLevel(previous, next, attack = 0.5, release = 0.08) {
        const k = next > previous ? attack : release;
        return previous + (next - previous) * k;
    }

    /** Mean of an analyser byte array. */
    function averageLevel(data) {
        if (!data || data.length === 0) return 0;
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        return sum / data.length;
    }

    return {
        calculateSize,
        calculateColor,
        colorForRatio,
        levelRatio,
        zoneForRatio,
        smoothLevel,
        averageLevel,
        CONSTANTS: {
            SENSITIVITY_PRESETS,
            SENSITIVITY_OPTIONS,
            YELLOW_POINT_RATIO,
            LOUD_RATIO,
            MAX_RATIO,
            MIN_SIZE,
            MAX_ADDITIONAL_SIZE,
            ZONE_LABELS,
            // Resting and fully-grown diameters of the floating orb, by size.
            ORB_DIAMETERS: { small: [44, 110], medium: [60, 138], large: [76, 150] },
            COLORS: { GREEN, AMBER, RED }
        }
    };
});
