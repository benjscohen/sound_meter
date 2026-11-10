const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
    onboarded: false,
    sensitivity: 140,
    deviceId: null,
    deviceLabel: null,
    paused: false,
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
