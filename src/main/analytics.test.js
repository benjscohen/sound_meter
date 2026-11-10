const {
    aggregate, byApp, meetingsForDay, meetingsByTitle, byPerson, heatmap, weekSummary, localDate, CONSTANTS
} = require('./analytics');

const MINUTE = 60 * 1000;
// Monday 4 May 2026, local time.
const at = (day, h, m = 0) => new Date(2026, 4, day, h, m).getTime();

// `count` full minutes starting at `start`.
function run(start, count, { avg = 0.2, peak = avg, loud = 0, app = null } = {}) {
    return Array.from({ length: count }, (_, i) => ({ t: start + i * MINUTE, n: 60, avg, peak, loud, app }));
}

const event = (title, start, minutes, people = []) => ({ title, start, end: start + minutes * MINUTE, people });

describe('aggregate', () => {
    test('weights averages by seconds monitored', () => {
        const totals = aggregate([
            { n: 60, avg: 0.2, peak: 0.5, loud: 0 },
            { n: 20, avg: 1.0, peak: 1.4, loud: 20 }
        ]);
        expect(totals).toEqual({ seconds: 80, avg: 0.4, peak: 1.4, loudSeconds: 20, share: 0.25 });
    });

    test('is all zeros for no data', () => {
        expect(aggregate([])).toEqual({ seconds: 0, avg: 0, peak: 0, loudSeconds: 0, share: 0 });
    });
});

describe('byApp', () => {
    test('groups by call app, most time first, with untagged time as its own row', () => {
        const rows = byApp([
            ...run(at(4, 9), 10, { app: 'Zoom', avg: 0.6, loud: 30 }),
            ...run(at(4, 10), 30, { app: null, avg: 0.2 }),
            ...run(at(4, 11), 5, { app: 'FaceTime', avg: 0.3 })
        ]);
        expect(rows.map((r) => r.label)).toEqual([CONSTANTS.NO_APP, 'Zoom', 'FaceTime']);
        expect(rows[1]).toMatchObject({ seconds: 600, avg: 0.6, loudSeconds: 300, share: 0.5 });
    });

    test('is empty when nothing was ever tagged, and drops slivers', () => {
        expect(byApp(run(at(4, 9), 30))).toEqual([]);
        const rows = byApp([...run(at(4, 9), 30, { app: 'Zoom' }), ...run(at(4, 10), 1, { app: 'Slack' })]);
        expect(rows.map((r) => r.label)).toEqual(['Zoom']);
    });
});

describe('meetings', () => {
    const minutes = [
        ...run(at(4, 9), 60, { avg: 0.2 }),
        ...run(at(4, 10), 30, { avg: 0.8, loud: 45 }),
        ...run(at(5, 10), 30, { avg: 0.6, loud: 15 })
    ];
    const events = [
        event('Standup', at(4, 9), 15, ['Maya']),
        event('Weekly sync', at(4, 10), 30, ['Maya', 'Jordan']),
        event('Weekly sync', at(5, 10), 30, ['Maya', 'Jordan']),
        event('Lunch', at(4, 12), 60, ['Sam']),                    // Not monitored
        event('All hands', at(4, 9, 30), 30, Array.from({ length: 20 }, (_, i) => `Person ${i}`))
    ];

    test('meetingsForDay lists monitored meetings in order', () => {
        const rows = meetingsForDay(minutes.filter((m) => m.t < at(5, 0)), events);
        expect(rows.map((r) => r.label)).toEqual(['Standup', 'All hands', 'Weekly sync']);
        expect(rows[0]).toMatchObject({ seconds: 900, avg: 0.2, share: 0, start: at(4, 9), end: at(4, 9, 15) });
        expect(rows[2]).toMatchObject({ seconds: 1800, avg: 0.8, share: 0.75, sessions: 1 });
    });

    test('meetingsByTitle rolls up repeats and ranks loudest first', () => {
        const rows = meetingsByTitle(minutes, events);
        // Standup and All hands tie on loudness; the one with more data wins.
        expect(rows.map((r) => r.label)).toEqual(['Weekly sync', 'All hands', 'Standup']);
        expect(rows[0]).toMatchObject({ sessions: 2, seconds: 3600, avg: 0.7, share: 0.5 });
    });

    test('byPerson credits small meetings only', () => {
        const rows = byPerson(minutes, events);
        expect(rows.map((r) => r.label)).toEqual(['Jordan', 'Maya']);
        expect(rows.find((r) => r.label === 'Jordan')).toMatchObject({ sessions: 2, seconds: 3600 });
        expect(rows.find((r) => r.label === 'Maya')).toMatchObject({ sessions: 3, seconds: 4500 });
        expect(rows.some((r) => r.label.startsWith('Person'))).toBe(false);
    });

    test('partial overlap counts the minutes that touch the meeting', () => {
        const rows = meetingsForDay(run(at(4, 9), 10), [event('Chat', at(4, 9, 5) + 30 * 1000, 3)]);
        expect(rows[0].seconds).toBe(4 * 60); // 9:05 through 9:08
    });

    test('no events or no minutes gives no rows', () => {
        expect(meetingsForDay(minutes, [])).toEqual([]);
        expect(meetingsByTitle([], events)).toEqual([]);
    });
});

describe('heatmap', () => {
    test('buckets by weekday (Monday first) and hour', () => {
        const map = heatmap([
            ...run(at(4, 9), 30, { avg: 0.2 }),   // Monday 9am
            ...run(at(5, 15), 40, { avg: 0.7 }),  // Tuesday 3pm
            ...run(at(10, 11), 20, { avg: 0.3 })  // Sunday 11am
        ]);
        expect(map.cells).toHaveLength(3);
        expect(map.hours).toEqual([9, 15]);
        expect(map.days).toEqual([0, 1, 6]);
        expect(map.loudest).toEqual({ dow: 1, hour: 15, avg: 0.7 });
    });

    test('ignores slots with too little data', () => {
        expect(heatmap(run(at(4, 9), 3))).toEqual({ cells: [], hours: [], days: [], loudest: null });
    });
});

describe('weekSummary', () => {
    const now = at(20, 15);
    const day = (daysAgo, seconds, loudSeconds, avg = 0.3) =>
        ({ date: localDate(now - daysAgo * 24 * 60 * MINUTE), seconds, loudSeconds, avg, peak: 1 });

    test('compares the last seven days with the seven before', () => {
        const week = weekSummary([day(0, 3600, 360), day(3, 3600, 0), day(8, 7200, 1440), day(20, 3600, 3600)], now);
        expect(week.current).toMatchObject({ seconds: 7200, loudSeconds: 360, share: 0.05 });
        expect(week.previous).toMatchObject({ seconds: 7200, loudSeconds: 1440, share: 0.2 });
    });

    test('previous is null without older data', () => {
        const week = weekSummary([day(1, 3600, 0)], now);
        expect(week.previous).toBeNull();
        expect(week.current.seconds).toBe(3600);
    });

    test('streak counts calm monitored days and skips days off', () => {
        const calm = (daysAgo) => day(daysAgo, 3600, 60);
        const loud = (daysAgo) => day(daysAgo, 3600, 900);
        expect(weekSummary([calm(0), calm(1), calm(4), loud(5), calm(6)], now).streak).toBe(3);
        expect(weekSummary([loud(0), calm(1)], now).streak).toBe(0);
        expect(weekSummary([], now).streak).toBe(0);
    });

    test('days with barely any monitoring neither count nor break the streak', () => {
        const streak = weekSummary([day(0, 3600, 0), day(1, 30, 30), day(2, 3600, 0)], now).streak;
        expect(streak).toBe(2);
    });
});
