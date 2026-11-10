const fs = require('fs');
const path = require('path');
const { CONSTANTS } = require('../utils/audio-visualizer');

const MINUTE = 60 * 1000;
const FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.json$/;

function localDate(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function round(value) {
    return Math.round(value * 1000) / 1000;
}

function summarize(date, minutes) {
    let seconds = 0;
    let sum = 0;
    let peak = 0;
    let loudSeconds = 0;
    let loudest = null;

    for (const m of minutes) {
        seconds += m.n;
        sum += m.avg * m.n;
        loudSeconds += m.loud;
        if (m.peak > peak) peak = m.peak;
        if (!loudest || m.avg > loudest.avg) loudest = m;
    }

    return {
        date,
        seconds,
        avg: seconds ? round(sum / seconds) : 0,
        peak: round(peak),
        loudSeconds,
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
 */
function createHistory(dir, { loudRatio = CONSTANTS.LOUD_RATIO } = {}) {
    let current = null; // { date, minutes: Map<t, bucket>, dirty, lastMinute }

    const fileFor = (date) => path.join(dir, `${date}.json`);

    function readDay(date) {
        const minutes = new Map();
        try {
            const parsed = JSON.parse(fs.readFileSync(fileFor(date), 'utf8'));
            for (const row of parsed.minutes || []) {
                const [t, n, sum, peak, loud] = row;
                if (Number.isFinite(t) && n > 0) minutes.set(t, { t, n, sum, peak, loud });
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
                .map((m) => [m.t, m.n, round(m.sum), round(m.peak), m.loud]);
            const tmp = `${fileFor(current.date)}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify({ v: 1, minutes: rows }));
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

    function record(sample, ts = Date.now()) {
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
            bucket = { t, n: 0, sum: 0, peak: 0, loud: 0 };
            day.minutes.set(t, bucket);
        }
        bucket.n += 1;
        bucket.sum += avg;
        bucket.peak = Math.max(bucket.peak, typeof peak === 'number' && Number.isFinite(peak) ? peak : avg);
        if (avg >= loudRatio) bucket.loud += 1;
        day.dirty = true;
    }

    function minutesFor(date) {
        const source = current && current.date === date ? current.minutes : readDay(date);
        return [...source.values()]
            .sort((a, b) => a.t - b.t)
            .map((m) => ({ t: m.t, n: m.n, avg: round(m.sum / m.n), peak: round(m.peak), loud: m.loud }));
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
        const lines = ['date,time,seconds_monitored,average_level_pct,peak_level_pct,loud_seconds'];
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
                    m.loud
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

    return { record, flush, getDay, listDays, listDates, prune, toCsv, clear };
}

module.exports = { createHistory, localDate, summarize };
