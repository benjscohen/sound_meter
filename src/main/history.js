const fs = require('fs');
const path = require('path');
const { CONSTANTS } = require('../utils/audio-visualizer');
const { aggregate, localDate } = require('./analytics');

const MINUTE = 60 * 1000;
const FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.json$/;

function round(value) {
    return Math.round(value * 1000) / 1000;
}

// The app credited for a minute is whichever was in use for most of it.
function dominantApp(bucket) {
    let best = null;
    for (const [app, seconds] of Object.entries(bucket.apps || {})) {
        if (!best || seconds > best[1]) best = [app, seconds];
    }
    return best && best[1] * 2 >= bucket.n ? best[0] : null;
}

// Day totals plus the loudest minute, for headlines like "Loudest around 2 PM".
function summarize(date, minutes) {
    let loudest = null;
    for (const m of minutes) {
        if (!loudest || m.avg > loudest.avg) loudest = m;
    }
    const { share, ...totals } = aggregate(minutes);
    return {
        date,
        ...totals,
        loudestAt: loudest ? loudest.t : null,
        loudestAvg: loudest ? loudest.avg : 0
    };
}

/**
 * Loudness history, kept as one small JSON file per local day containing
 * per-minute aggregates. Only numbers are stored - never audio.
 *
 * A "sample" is one second of listening: { avg, peak } expressed as a ratio
 * of the user's "too loud" threshold (see levelRatio in audio-visualizer).
 * Each minute can also remember which call app was in use.
 */
function createHistory(dir, { loudRatio = CONSTANTS.LOUD_RATIO } = {}) {
    let current = null; // { date, minutes: Map<t, bucket>, dirty, lastMinute }

    const fileFor = (date) => path.join(dir, `${date}.json`);

    function readDay(date) {
        const minutes = new Map();
        try {
            const parsed = JSON.parse(fs.readFileSync(fileFor(date), 'utf8'));
            for (const row of parsed.minutes || []) {
                const [t, n, sum, peak, loud, app] = row;
                if (!Number.isFinite(t) || !(n > 0)) continue;
                minutes.set(t, { t, n, sum, peak, loud, apps: typeof app === 'string' && app ? { [app]: n } : {} });
            }
        } catch {
            // No file yet (or unreadable): treat as an empty day.
        }
        return minutes;
    }

    function flush() {
        if (!current || !current.dirty) return;
        try {
            fs.mkdirSync(dir, { recursive: true });
            const rows = [...current.minutes.values()]
                .sort((a, b) => a.t - b.t)
                .map((m) => {
                    const row = [m.t, m.n, round(m.sum), round(m.peak), m.loud];
                    const app = dominantApp(m);
                    if (app) row.push(app);
                    return row;
                });
            const tmp = `${fileFor(current.date)}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify({ v: 2, minutes: rows }));
            fs.renameSync(tmp, fileFor(current.date));
            current.dirty = false;
        } catch (error) {
            console.error('Failed to write history:', error);
        }
    }

    function open(date) {
        if (current && current.date === date) return current;
        flush();
        current = { date, minutes: readDay(date), dirty: false, lastMinute: null };
        return current;
    }

    function record(sample, ts = Date.now(), { app = null } = {}) {
        if (!sample || typeof sample.avg !== 'number') return;
        const { avg, peak } = sample;
        if (!Number.isFinite(avg) || avg < 0) return;

        const day = open(localDate(ts));
        const t = Math.floor(ts / MINUTE) * MINUTE;

        // Persist whenever we roll into a new minute so a crash loses <60s.
        if (day.lastMinute !== null && day.lastMinute !== t) flush();
        day.lastMinute = t;

        let bucket = day.minutes.get(t);
        if (!bucket) {
            bucket = { t, n: 0, sum: 0, peak: 0, loud: 0, apps: {} };
            day.minutes.set(t, bucket);
        }
        bucket.n += 1;
        bucket.sum += avg;
        bucket.peak = Math.max(bucket.peak, typeof peak === 'number' && Number.isFinite(peak) ? peak : avg);
        if (avg >= loudRatio) bucket.loud += 1;
        if (typeof app === 'string' && app) bucket.apps[app] = (bucket.apps[app] || 0) + 1;
        day.dirty = true;
    }

    function minutesFor(date) {
        const source = current && current.date === date ? current.minutes : readDay(date);
        return [...source.values()]
            .sort((a, b) => a.t - b.t)
            .map((m) => ({ t: m.t, n: m.n, avg: round(m.sum / m.n), peak: round(m.peak), loud: m.loud, app: dominantApp(m) }));
    }

    /** Every minute from the last `days` local days, oldest first. */
    function getRange(days, now = Date.now()) {
        const cutoff = localDate(now - (days - 1) * 24 * 60 * MINUTE);
        return listDates()
            .filter((date) => date >= cutoff)
            .reverse()
            .flatMap((date) => minutesFor(date));
    }

    function getDay(date) {
        const minutes = minutesFor(date);
        return { date, minutes, summary: summarize(date, minutes) };
    }

    function listDates() {
        const dates = new Set();
        try {
            for (const name of fs.readdirSync(dir)) {
                const match = FILE_PATTERN.exec(name);
                if (match) dates.add(match[1]);
            }
        } catch {
            // Directory doesn't exist yet.
        }
        if (current && current.minutes.size > 0) dates.add(current.date);
        return [...dates].sort().reverse();
    }

    function listDays(limit = 14) {
        return listDates()
            .slice(0, limit)
            .map((date) => summarize(date, minutesFor(date)));
    }

    /** Delete day files older than `keepDays`. Returns how many were removed. */
    function prune(keepDays = 90, now = Date.now()) {
        const cutoff = localDate(now - keepDays * 24 * 60 * MINUTE);
        let removed = 0;
        for (const date of listDates()) {
            if (date < cutoff && !(current && current.date === date)) {
                try {
                    fs.unlinkSync(fileFor(date));
                    removed += 1;
                } catch {
                    // Already gone.
                }
            }
        }
        return removed;
    }

    function toCsv() {
        const lines = ['date,time,seconds_monitored,average_level_pct,peak_level_pct,loud_seconds,app'];
        const pad = (n) => String(n).padStart(2, '0');
        for (const date of listDates().reverse()) {
            for (const m of minutesFor(date)) {
                const d = new Date(m.t);
                lines.push([
                    date,
                    `${pad(d.getHours())}:${pad(d.getMinutes())}`,
                    m.n,
                    Math.round(m.avg * 100),
                    Math.round(m.peak * 100),
                    m.loud,
                    m.app ? `"${m.app.replace(/"/g, '""')}"` : ''
                ].join(','));
            }
        }
        return lines.join('\n') + '\n';
    }

    function clear() {
        for (const date of listDates()) {
            try {
                fs.unlinkSync(fileFor(date));
            } catch {
                // Already gone.
            }
        }
        current = null;
    }

    return { record, flush, getDay, getRange, listDays, listDates, prune, toCsv, clear };
}

module.exports = { createHistory, localDate, summarize };
