const { createNudger, weekKey, recapDue } = require('./reminders');
const { createCalibrator } = require('./calibration');

const SECOND = 1000;
const MINUTE = 60 * SECOND;

describe('nudger', () => {
    const feed = (nudger, levels, start = 0) => levels.map((avg, i) => nudger.sample(avg, start + i * SECOND));

    test('fires once after sustained loudness, not on a brief spike', () => {
        const nudger = createNudger();
        expect(feed(nudger, [0.9, 0.9, 0.9, 0.2, 0.2, 0.2, 0.2, 0.2])).not.toContain(true);
        const fired = feed(createNudger(), Array(12).fill(0.9));
        expect(fired.filter(Boolean)).toHaveLength(1);
        expect(fired.indexOf(true)).toBe(7); // The eighth loud second
    });

    test('tolerates a breath in the middle', () => {
        const fired = feed(createNudger(), [0.9, 0.9, 0.9, 0.9, 0.3, 0.9, 0.9, 0.9, 0.9, 0.9]);
        expect(fired.filter(Boolean)).toHaveLength(1);
    });

    test('respects the cooldown, then can fire again', () => {
        const nudger = createNudger({ cooldownMs: 5 * MINUTE });
        expect(feed(nudger, Array(10).fill(1))).toContain(true);
        expect(feed(nudger, Array(60).fill(1), 20 * SECOND)).not.toContain(true);
        expect(feed(nudger, Array(10).fill(1), 6 * MINUTE)).toContain(true);
    });

    test('loud seconds far apart never add up', () => {
        const nudger = createNudger();
        const fired = Array.from({ length: 30 }, (_, i) => nudger.sample(0.9, i * 5 * SECOND));
        expect(fired).not.toContain(true);
    });
});

describe('weekly recap', () => {
    const at = (day, hour) => new Date(2026, 10, day, hour).getTime(); // November 2026; the 9th is a Monday

    test('weekKey is the Monday of the week, in local time', () => {
        expect(weekKey(at(9, 0))).toBe('2026-11-09');
        expect(weekKey(at(11, 15))).toBe('2026-11-09');
        expect(weekKey(at(15, 23))).toBe('2026-11-09'); // Sunday
        expect(weekKey(at(16, 0))).toBe('2026-11-16');
    });

    test('first run records the week without showing anything', () => {
        expect(recapDue({ now: at(10, 12), lastWeek: null, monitoredSeconds: 99999 })).toEqual({ show: false, week: '2026-11-09' });
    });

    test('shows once in a new week, from 9am, when there is a week to recap', () => {
        const base = { lastWeek: '2026-11-09', monitoredSeconds: 3 * 3600 };
        expect(recapDue({ ...base, now: at(13, 10) })).toEqual({ show: false, week: '2026-11-09' });
        expect(recapDue({ ...base, now: at(16, 8) })).toEqual({ show: false, week: '2026-11-09' }); // Too early: ask again later
        expect(recapDue({ ...base, now: at(16, 9) })).toEqual({ show: true, week: '2026-11-16' });
        expect(recapDue({ ...base, lastWeek: '2026-11-16', now: at(16, 15) })).toEqual({ show: false, week: '2026-11-16' });
    });

    test('still shows later in the week if Monday was missed, but not for an empty week', () => {
        expect(recapDue({ lastWeek: '2026-11-09', monitoredSeconds: 3 * 3600, now: at(19, 14) }).show).toBe(true);
        expect(recapDue({ lastWeek: '2026-11-09', monitoredSeconds: 60, now: at(16, 10) })).toEqual({ show: false, week: '2026-11-16' });
    });
});

describe('calibrator', () => {
    // A believable minute: a quiet room with stretches of talking.
    const talk = (level, seconds) => Array.from({ length: seconds }, (_, i) => level + (i % 5) - 2);
    const room = (seconds) => Array.from({ length: seconds }, (_, i) => 6 + (i % 3));

    function learn(levels, options) {
        const calibrator = createCalibrator(options);
        let result = null;
        for (const level of levels) result = result ?? calibrator.add(level);
        return { result, calibrator };
    }

    test('places normal speech comfortably in the green', () => {
        const { result } = learn([...room(20), ...talk(53, 30), ...room(10), ...talk(53, 30)]);
        expect(result).toBeGreaterThanOrEqual(130);
        expect(result).toBeLessThanOrEqual(150); // 53 / 0.38 ≈ 139: close to the Medium preset
    });

    test('a quiet talker and a loud talker get different limits, within bounds', () => {
        expect(learn([...room(20), ...talk(22, 60)]).result).toBe(70);        // Clamped to the most sensitive preset
        expect(learn([...room(20), ...talk(95, 60)]).result).toBeGreaterThan(220);
        expect(learn([...room(20), ...talk(250, 60)]).result).toBe(350);      // Clamped to the least sensitive
    });

    test('waits for enough talking; silence alone never calibrates', () => {
        const quiet = learn(room(300));
        expect(quiet.result).toBeNull();
        expect(quiet.calibrator.progress()).toBeLessThan(0.5);

        const brief = learn([...room(30), ...talk(60, 20)]);
        expect(brief.result).toBeNull();
        expect(brief.calibrator.progress()).toBeGreaterThan(0.3);
        expect(brief.calibrator.progress()).toBeLessThan(1);
    });

    test('ignores junk and can start over', () => {
        const calibrator = createCalibrator();
        expect(calibrator.add(NaN)).toBeNull();
        expect(calibrator.add(-5)).toBeNull();
        for (const level of [...room(20), ...talk(60, 40)]) calibrator.add(level);
        calibrator.reset();
        expect(calibrator.progress()).toBe(0);
    });
});
