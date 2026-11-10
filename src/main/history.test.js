const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHistory, localDate } = require('./history');
const { createSettings, DEFAULTS } = require('./settings');

let dir;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-meter-test-'));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

// Local-time helper so tests pass in any timezone.
const at = (day, h, m, s = 0) => new Date(2026, 4, day, h, m, s).getTime();

describe('history', () => {
    test('aggregates one-second samples into minutes', () => {
        const history = createHistory(dir);
        for (let s = 0; s < 60; s++) history.record({ avg: 0.2, peak: 0.4 }, at(4, 9, 0, s));
        for (let s = 0; s < 30; s++) history.record({ avg: 0.9, peak: 1.2 }, at(4, 9, 1, s));

        const { minutes, summary } = history.getDay('2026-05-04');
        expect(minutes).toHaveLength(2);
        expect(minutes[0]).toMatchObject({ n: 60, avg: 0.2, peak: 0.4, loud: 0 });
        expect(minutes[1]).toMatchObject({ n: 30, avg: 0.9, peak: 1.2, loud: 30 });

        expect(summary.seconds).toBe(90);
        expect(summary.loudSeconds).toBe(30);
        expect(summary.peak).toBe(1.2);
        expect(summary.avg).toBeCloseTo((0.2 * 60 + 0.9 * 30) / 90, 3);
        expect(summary.loudestAt).toBe(at(4, 9, 1));
    });

    test('persists across instances and keeps appending to the same day', () => {
        const first = createHistory(dir);
        first.record({ avg: 0.5, peak: 0.5 }, at(4, 10, 0));
        first.flush();

        const second = createHistory(dir);
        second.record({ avg: 0.1, peak: 0.1 }, at(4, 10, 0, 1));
        second.record({ avg: 0.1, peak: 0.1 }, at(4, 11, 30));
        second.flush();

        const { minutes } = createHistory(dir).getDay('2026-05-04');
        expect(minutes.map((m) => m.n)).toEqual([2, 1]);
        expect(minutes[0].avg).toBeCloseTo(0.3, 3);
    });

    test('flushes automatically when the minute rolls over', () => {
        const history = createHistory(dir);
        history.record({ avg: 0.3, peak: 0.3 }, at(4, 12, 0));
        expect(fs.existsSync(path.join(dir, '2026-05-04.json'))).toBe(false);
        history.record({ avg: 0.3, peak: 0.3 }, at(4, 12, 1));
        expect(fs.existsSync(path.join(dir, '2026-05-04.json'))).toBe(true);
    });

    test('splits days at local midnight and lists newest first', () => {
        const history = createHistory(dir);
        history.record({ avg: 0.4, peak: 0.4 }, at(4, 23, 59, 59));
        history.record({ avg: 0.8, peak: 0.8 }, at(5, 0, 0, 0));

        const days = history.listDays();
        expect(days.map((d) => d.date)).toEqual(['2026-05-05', '2026-05-04']);
        expect(days[0].loudSeconds).toBe(1);
        expect(days[1].loudSeconds).toBe(0);
        expect(history.listDays(1)).toHaveLength(1);
    });

    test('ignores invalid samples', () => {
        const history = createHistory(dir);
        history.record({ avg: NaN, peak: 1 }, at(4, 9, 0));
        history.record(null, at(4, 9, 0));
        history.record({ avg: -1 }, at(4, 9, 0));
        expect(history.listDays()).toEqual([]);
        expect(history.getDay('2026-05-04').summary.seconds).toBe(0);
    });

    test('survives a corrupt day file', () => {
        fs.writeFileSync(path.join(dir, '2026-05-04.json'), '{not json');
        const history = createHistory(dir);
        expect(history.getDay('2026-05-04').minutes).toEqual([]);
        history.record({ avg: 0.2, peak: 0.2 }, at(4, 9, 0));
        history.flush();
        expect(createHistory(dir).getDay('2026-05-04').minutes).toHaveLength(1);
    });

    test('prunes old days but keeps recent ones', () => {
        const history = createHistory(dir);
        history.record({ avg: 0.2, peak: 0.2 }, at(1, 9, 0));
        history.record({ avg: 0.2, peak: 0.2 }, at(20, 9, 0));
        history.flush();

        const removed = history.prune(7, at(21, 9, 0));
        expect(removed).toBe(1);
        expect(history.listDates()).toEqual(['2026-05-20']);
    });

    test('exports CSV and clears', () => {
        const history = createHistory(dir);
        history.record({ avg: 0.5, peak: 1 }, at(4, 9, 5));
        history.record({ avg: 0.8, peak: 0.9 }, at(5, 14, 30), { app: 'Zoom "Pro"' });

        expect(history.toCsv().trim().split('\n')).toEqual([
            'date,time,seconds_monitored,average_level_pct,peak_level_pct,loud_seconds,app',
            '2026-05-04,09:05,1,50,100,0,',
            '2026-05-05,14:30,1,80,90,1,"Zoom ""Pro"""'
        ]);

        history.clear();
        expect(history.listDates()).toEqual([]);
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    test('credits each minute to the app in use for most of it', () => {
        const history = createHistory(dir);
        for (let s = 0; s < 60; s++) history.record({ avg: 0.3, peak: 0.3 }, at(4, 9, 0, s), { app: s < 40 ? 'Zoom' : 'Slack' });
        for (let s = 0; s < 60; s++) history.record({ avg: 0.3, peak: 0.3 }, at(4, 9, 1, s), { app: s < 20 ? 'Zoom' : null });
        history.flush();

        const { minutes } = createHistory(dir).getDay('2026-05-04');
        expect(minutes.map((m) => m.app)).toEqual(['Zoom', null]);

        // A reloaded minute keeps its app when more samples arrive.
        const reopened = createHistory(dir);
        reopened.record({ avg: 0.3, peak: 0.3 }, at(4, 9, 0, 59));
        expect(reopened.getDay('2026-05-04').minutes[0].app).toBe('Zoom');
    });

    test('reads files written before apps were recorded', () => {
        fs.writeFileSync(path.join(dir, '2026-05-04.json'), JSON.stringify({ v: 1, minutes: [[at(4, 9, 0), 60, 12, 0.5, 3]] }));
        const { minutes, summary } = createHistory(dir).getDay('2026-05-04');
        expect(minutes).toEqual([{ t: at(4, 9, 0), n: 60, avg: 0.2, peak: 0.5, loud: 3, app: null }]);
        expect(summary.loudSeconds).toBe(3);
    });

    test('getRange returns the last N days, oldest first', () => {
        const history = createHistory(dir);
        history.record({ avg: 0.1, peak: 0.1 }, at(1, 9, 0));
        history.record({ avg: 0.2, peak: 0.2 }, at(19, 9, 0));
        history.record({ avg: 0.3, peak: 0.3 }, at(20, 9, 0));

        const range = history.getRange(2, at(20, 12, 0));
        expect(range.map((m) => m.avg)).toEqual([0.2, 0.3]);
        expect(history.getRange(28, at(20, 12, 0))).toHaveLength(3);
    });

    test('localDate formats in local time', () => {
        expect(localDate(at(4, 0, 0))).toBe('2026-05-04');
        expect(localDate(at(4, 23, 59, 59))).toBe('2026-05-04');
    });
});

describe('settings', () => {
    test('starts from defaults and round-trips updates', () => {
        const file = path.join(dir, 'nested', 'settings.json');
        const settings = createSettings(file);
        expect(settings.all()).toEqual(DEFAULTS);

        expect(settings.update({ sensitivity: 210, position: { x: 10, y: 20 } })).toBe(true);
        expect(settings.update({ sensitivity: 210 })).toBe(false);

        const reloaded = createSettings(file);
        expect(reloaded.get('sensitivity')).toBe(210);
        expect(reloaded.get('position')).toEqual({ x: 10, y: 20 });
        expect(reloaded.get('onboarded')).toBe(false);
    });

    test('existing users keep their hand-picked sensitivity; new users get automatic', () => {
        const file = path.join(dir, 'settings.json');
        expect(createSettings(file).get('sensitivityMode')).toBe('auto');

        fs.writeFileSync(file, JSON.stringify({ onboarded: true, sensitivity: 210 }));
        const existing = createSettings(file);
        expect(existing.get('sensitivityMode')).toBe('manual');
        expect(existing.get('sensitivity')).toBe(210);

        fs.writeFileSync(file, JSON.stringify({ onboarded: true, sensitivityMode: 'auto', calibrated: true, sensitivity: 123 }));
        expect(createSettings(file).get('sensitivityMode')).toBe('auto');
    });

    test('ignores unknown keys and corrupt files', () => {
        const file = path.join(dir, 'settings.json');
        fs.writeFileSync(file, 'nope');
        const settings = createSettings(file);
        expect(settings.all()).toEqual(DEFAULTS);
        expect(settings.update({ bogus: 1 })).toBe(false);
        expect(settings.all()).not.toHaveProperty('bogus');
    });
});
