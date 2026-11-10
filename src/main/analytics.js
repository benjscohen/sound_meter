// Pure functions that turn per-minute loudness history into the numbers
// Insights shows. No I/O here: history and calendar data are passed in.
//
// A "minute" is { t, n, avg, peak, loud, app } (see history.js): n seconds
// monitored starting at t, average and peak level as a fraction of the
// user's limit, and how many of those seconds were too loud.

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const MIN_GROUP_SECONDS = 120;   // Ignore groups with less data than this
const MAX_MEETING_PEOPLE = 8;    // Bigger meetings say little about any one person
const CALM_SHARE = 0.05;         // A "calm" day: under 5% of the time too loud
const MIN_DAY_SECONDS = 600;     // A day counts once you've monitored 10 minutes
const NO_APP = 'No call app';

const round = (value) => Math.round(value * 1000) / 1000;

function localDate(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Totals for any set of minutes. */
function aggregate(minutes) {
    let seconds = 0;
    let sum = 0;
    let peak = 0;
    let loudSeconds = 0;
    for (const m of minutes) {
        seconds += m.n;
        sum += m.avg * m.n;
        loudSeconds += m.loud;
        if (m.peak > peak) peak = m.peak;
    }
    return {
        seconds,
        avg: seconds ? round(sum / seconds) : 0,
        peak: round(peak),
        loudSeconds,
        share: seconds ? round(loudSeconds / seconds) : 0
    };
}

/** Loudest first: by share of time too loud, then by average level. */
const byLoudness = (a, b) => b.share - a.share || b.avg - a.avg || b.seconds - a.seconds;

/**
 * Groups minutes by any number of keys per minute. `keysFor(minute)` returns
 * an array of { key, label, ...extra }; a minute counts toward each.
 */
function groupMinutes(minutes, keysFor, { minSeconds = MIN_GROUP_SECONDS } = {}) {
    const groups = new Map();
    for (const minute of minutes) {
        for (const { key, ...info } of keysFor(minute)) {
            let group = groups.get(key);
            if (!group) {
                group = { info, minutes: [] };
                groups.set(key, group);
            }
            group.minutes.push(minute);
        }
    }
    return [...groups.entries()]
        .map(([key, group]) => ({ key, ...group.info, ...aggregate(group.minutes) }))
        .filter((row) => row.seconds >= minSeconds);
}

/** Where you were talking: one row per app that was on a call. */
function byApp(minutes) {
    if (!minutes.some((m) => m.app)) return [];
    return groupMinutes(minutes, (m) => [{ key: m.app || NO_APP, label: m.app || NO_APP }])
        .sort((a, b) => b.seconds - a.seconds);
}

const overlaps = (minute, event) => minute.t + MINUTE > event.start && minute.t < event.end;

/**
 * Joins minutes with calendar events. `keysFor(event)` decides the grouping:
 * per event, per title, per person...
 */
function byEvents(minutes, events, keysFor, options) {
    const sessions = new Map();
    const rows = groupMinutes(minutes, (minute) => {
        const keys = [];
        for (const event of events) {
            if (!overlaps(minute, event)) continue;
            for (const entry of keysFor(event)) {
                keys.push(entry);
                if (!sessions.has(entry.key)) sessions.set(entry.key, new Set());
                sessions.get(entry.key).add(event.start);
            }
        }
        return keys;
    }, options);
    return rows.map((row) => ({ ...row, sessions: sessions.get(row.key).size }));
}

/** One row per meeting, in the order they happened. */
function meetingsForDay(minutes, events) {
    return byEvents(minutes, events, (e) => [{ key: `${e.start}|${e.title}`, label: e.title, start: e.start, end: e.end }])
        .sort((a, b) => a.start - b.start);
}

/** Recurring meetings rolled up by title, loudest first. */
function meetingsByTitle(minutes, events) {
    return byEvents(minutes, events, (e) => [{ key: e.title.toLowerCase(), label: e.title }]).sort(byLoudness);
}

/** Who you get loud with: one row per person from small meetings. */
function byPerson(minutes, events) {
    const small = events.filter((e) => e.people.length > 0 && e.people.length <= MAX_MEETING_PEOPLE);
    return byEvents(minutes, small, (e) => e.people.map((name) => ({ key: name.toLowerCase(), label: name })))
        .sort(byLoudness);
}

/**
 * Average level for each weekday/hour slot. Weekdays run Monday (0) to
 * Sunday (6).
 */
function heatmap(minutes) {
    const cells = groupMinutes(minutes, (m) => {
        const d = new Date(m.t);
        const dow = (d.getDay() + 6) % 7;
        return [{ key: `${dow}-${d.getHours()}`, dow, hour: d.getHours() }];
    }, { minSeconds: 5 * 60 });

    if (!cells.length) return { cells: [], hours: [], days: [], loudest: null };

    const hours = cells.map((c) => c.hour);
    const loudest = cells.filter((c) => c.seconds >= 15 * 60).sort((a, b) => b.avg - a.avg)[0] || null;
    return {
        cells,
        hours: [Math.min(...hours), Math.max(...hours)],
        days: [...new Set(cells.map((c) => c.dow))].sort((a, b) => a - b),
        loudest: loudest && { dow: loudest.dow, hour: loudest.hour, avg: loudest.avg }
    };
}

/**
 * This week against last week, plus the current calm streak.
 * `days` are day summaries ({ date, seconds, avg, loudSeconds }) in any order.
 */
function weekSummary(days, now = Date.now()) {
    const byDate = new Map(days.map((d) => [d.date, d]));
    const window = (fromDaysAgo, toDaysAgo) => {
        const picked = [];
        for (let i = fromDaysAgo; i <= toDaysAgo; i++) {
            const day = byDate.get(localDate(now - i * DAY));
            if (day) picked.push({ n: day.seconds, avg: day.avg, peak: day.peak || 0, loud: day.loudSeconds });
        }
        return picked.length ? aggregate(picked) : null;
    };

    // Count back through monitored days; days off don't break the streak.
    let streak = 0;
    const recent = [...byDate.values()]
        .filter((d) => d.seconds >= MIN_DAY_SECONDS && d.date <= localDate(now))
        .sort((a, b) => (a.date < b.date ? 1 : -1));
    for (const day of recent) {
        if (day.loudSeconds / day.seconds > CALM_SHARE) break;
        streak += 1;
    }

    return { current: window(0, 6), previous: window(7, 13), streak, calmShare: CALM_SHARE };
}

module.exports = {
    aggregate,
    byApp,
    meetingsForDay,
    meetingsByTitle,
    byPerson,
    heatmap,
    weekSummary,
    localDate,
    CONSTANTS: { NO_APP, CALM_SHARE, MAX_MEETING_PEOPLE, MIN_GROUP_SECONDS }
};
