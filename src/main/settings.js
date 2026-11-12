const fs = require('fs');
const path = require('path');

// Bumped when a default changes in a way existing installs should pick up.
const REVISION = 2;

const DEFAULTS = Object.freeze({
    revision: REVISION,
    onboarded: false,
    sensitivity: 140,
    sensitivityMode: 'auto',    // 'auto' learns your voice once; 'manual' uses the chosen preset
    calibrated: false,          // Whether 'auto' has finished learning
    voiceFocus: true,           // Ignore what the Mac is playing, so speakers don't count as you
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
    position: null // { x, y } of the centre of the floating orb
});

/**
 * Tiny JSON-file settings store. Synchronous on purpose: the file is a few
 * hundred bytes and we want settings available before the first window opens.
 */
function createSettings(filePath) {
    let data = { ...DEFAULTS };
    let migrated = false;

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            data = { ...DEFAULTS, ...parsed };
            // People who set up before automatic sensitivity existed chose
            // their level by hand: keep it.
            if (parsed.onboarded && !('sensitivityMode' in parsed)) data.sensitivityMode = 'manual';
            // Voice Focus became the default in revision 2. Until then it was
            // an opt-in beta, so "off" was nobody's decision: switch it on once.
            // Turning it off afterwards sticks.
            if (!(parsed.revision >= 2)) {
                data.voiceFocus = true;
                // The saved position used to be the corner of the orb's
                // 168px window; it is now the centre of the orb.
                const at = parsed.position;
                if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) data.position = { x: at.x + 84, y: at.y + 84 };
            }
            data.revision = REVISION;
            migrated = parsed.revision !== REVISION;
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

    if (migrated) save();

    return {
        get: (key) => data[key],
        all: () => ({ ...data }),
        update(patch) {
            let changed = false;
            for (const [key, value] of Object.entries(patch || {})) {
                if (!(key in DEFAULTS) || key === 'revision') continue;
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

// Voice Focus relies on Core Audio taps, which arrived in macOS 14.2.
function supportsVoiceFocus(platform, version) {
    if (platform !== 'darwin') return false;
    const [major = 0, minor = 0] = String(version).split('.').map(Number);
    return major > 14 || (major === 14 && minor >= 2);
}

module.exports = { createSettings, supportsVoiceFocus, DEFAULTS };
