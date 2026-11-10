/**
 * Tracks whether another app is using the microphone, and from that whether
 * Sound Meter should be idle (orb hidden, microphone released) when "Listen
 * Only During Calls" is on.
 *
 * Two things keep it from flapping:
 *  - a failed reading (`null`) changes nothing; the last known state stands
 *  - going idle waits for a grace period, so a call app that lets go of the
 *    microphone for a moment (muting, switching devices) doesn't make the
 *    orb blink away and miss your next words
 */
function createPresence({ graceMs = 45 * 1000 } = {}) {
    let supported = false;
    let known = false;       // Has any reading succeeded yet?
    let app = null;
    let lastSeen = -Infinity; // When an app was last using the microphone

    return {
        /**
         * `reading` is { supported, app } from native.micState(), or null if
         * it couldn't be read. Returns { supported, known, app, idle }.
         */
        update({ reading, onlyDuringCalls, now = Date.now() }) {
            if (reading) {
                known = true;
                supported = !!reading.supported;
                app = supported ? reading.app || null : null;
                if (app) lastSeen = now;
            }
            const idle = !!onlyDuringCalls && supported && !app && now - lastSeen >= graceMs;
            return { supported, known, app, idle };
        }
    };
}

module.exports = { createPresence };
