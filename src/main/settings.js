const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
    onboarded: false,
    sensitivity: 140,
    sensitivityMode: 'auto',    // 'auto' learns your voice once; 'manual' uses the chosen preset
    calibrated: false,          // Whether 'auto' has finished learning
    voiceFocus: false,          // Beta: macOS voice processing, so speaker sound counts less
    deviceId: null,
    deviceLabel: null,
    paused: false,
    calendar: false, // Opted in to showing calendar meetings in Insights
    nudge: false,               // Notify after staying too loud for a while
    weeklyRecap: false,         // One notification a week inviting you to see last week's card
    lastRecapWeek: null,        // Monday (YYYY-MM-DD) of the last week a recap was considered
    orbSize: 'medium',          // 'small' | 'medium' | 'large'
    orbOpacity: 1,              // 1 | 0.75 | 0.5
    symbols: false,             // Show level symbols in the orb, not just colour
    onlyDuringCalls: false,     // Hide and stop listening unless a call app is using the mic
    position: null // { x, y } of the floating meter
});

/**
 * Tiny JSON-file settings store. Synchronous on purpose: the file is a few
 * hundred bytes and we want settings available before the first window opens.
 */
function createSettings(filePath) {
    let data = { ...DEFAULTS };

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            data = { ...DEFAULTS, ...parsed };
            // People who set up before automatic sensitivity existed chose
            // their level by hand: keep it.
            if (parsed.onboarded && !('sensitivityMode' in parsed)) data.sensitivityMode = 'manual';
        }
    } catch {
        // Missing or corrupt file: start from defaults.
    }

    function save() {
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            const tmp = `${filePath}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
            fs.renameSync(tmp, filePath);
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }

    return {
        get: (key) => data[key],
        all: () => ({ ...data }),
        update(patch) {
            let changed = false;
            for (const [key, value] of Object.entries(patch || {})) {
                if (!(key in DEFAULTS)) continue;
                if (JSON.stringify(data[key]) !== JSON.stringify(value)) {
                    data[key] = value;
                    changed = true;
                }
            }
            if (changed) save();
            return changed;
        }
    };
}

module.exports = { createSettings, DEFAULTS };
