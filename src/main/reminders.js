// The two things Sound Meter may notify about: a nudge after you've been
// loud for a while, and a weekly recap. Both are pure decisions here; the
// main process shows the notifications.
const { CONSTANTS } = require('../utils/audio-visualizer');

const MINUTE = 60 * 1000;

/**
 * Decides when to nudge: after `sustainSeconds` of the last `windowSeconds`
 * were too loud, and at most once per cooldown. Fed one sample a second.
 */
function createNudger({
    sustainSeconds = 8,
    windowSeconds = 10,
    cooldownMs = 5 * MINUTE,
    loudRatio = CONSTANTS.LOUD_RATIO
} = {}) {
    let recent = [];
    let lastFired = -Infinity;

    return {
        /** Returns true when a nudge should be shown for this sample. */
        sample(avg, ts = Date.now()) {
            recent.push({ ts, loud: avg >= loudRatio });
            recent = recent.filter((s) => ts - s.ts < windowSeconds * 1000);
            const loud = recent.filter((s) => s.loud).length;
            if (loud < sustainSeconds || ts - lastFired < cooldownMs) return false;
            lastFired = ts;
            recent = [];
            return true;
        },
        reset() {
            recent = [];
        }
    };
}

/** Identifies a week by the local date of its Monday, e.g. "2026-11-09". */
function weekKey(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Should the weekly recap be shown now? Once per week, from 9am, and only
 * if there is a meaningful week behind it. The very first week just records
 * where we are, so nobody is greeted with a recap of nothing.
 *
 * Returns { show, week }; store `week` as the last recap week when it is
 * different from what was passed in.
 */
function recapDue({ now = Date.now(), lastWeek, monitoredSeconds = 0, minSeconds = 30 * 60 }) {
    const week = weekKey(now);
    if (!lastWeek) return { show: false, week };
    if (lastWeek === week) return { show: false, week };
    if (new Date(now).getHours() < 9) return { show: false, week: lastWeek };
    return { show: monitoredSeconds >= minSeconds, week };
}

module.exports = { createNudger, weekKey, recapDue };
