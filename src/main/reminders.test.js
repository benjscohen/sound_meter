const { createNudger, weekKey, recapDue } = require('./reminders');
const { createCalibrator } = require('./calibration');
const { createPresence } = require('./presence');
const { describeUpdateError } = require('./update-errors');

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

    test('never repeats if the clock goes backwards', () => {
        // Shown for the week of the 16th, then the clock is set back a week.
        expect(recapDue({ lastWeek: '2026-11-16', monitoredSeconds: 3 * 3600, now: at(12, 10) })).toEqual({ show: false, week: '2026-11-16' });
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
        const soft = learn([...room(20), ...talk(30, 60)]).result;
        expect(soft).toBeGreaterThanOrEqual(70);
        expect(soft).toBeLessThan(90);                                        // Near the most sensitive preset
        expect(learn([...room(20), ...talk(95, 60)]).result).toBeGreaterThan(220);
        expect(learn([...room(20), ...talk(250, 60)]).result).toBe(350);      // Clamped to the least sensitive
    });

    test('waits for enough talking; silence alone never calibrates', () => {
        const quiet = learn(room(300));
        expect(quiet.result).toBeNull();
        expect(quiet.calibrator.progress()).toBeLessThan(0.5);

        const brief = learn([...room(30), ...talk(60, 14)]);
        expect(brief.result).toBeNull();
        expect(brief.calibrator.progress()).toBeGreaterThan(0.3);
        expect(brief.calibrator.progress()).toBeLessThan(1);
    });

    test('a real reading: one person on a call, mostly listening', () => {
        // Per-second microphone levels captured from a real call (webcam mic,
        // call audio on speakers): a few bursts of speech over a room at 13-20.
        const real = [
        1, 12, 55, 65, 49, 38, 10, 43, 41, 15, 54, 38, 26, 18, 6, 24, 21, 14, 16, 14, 11, 14, 13, 14, 22, 17, 16, 18, 16, 18,
        16, 10, 17, 16, 25, 14, 29, 19, 20, 13, 22, 13, 14, 23, 21, 15, 25, 17, 15, 19, 20, 18, 11, 16, 24, 16, 14, 14, 12, 20,
        16, 16, 19, 17, 19, 15, 19, 18, 21, 11, 16, 18, 20, 23, 17, 15, 16, 20, 19, 12, 20, 20, 18, 16, 14, 19, 23, 14, 19, 14,
        18, 17, 18, 18, 11, 14, 18, 13, 15, 13, 13, 21, 12, 13, 14, 22, 19, 16, 15, 15, 13, 20, 21, 12, 18, 16, 16, 21, 18, 22,
        15, 16, 18, 20, 19, 22, 16, 15, 14, 20, 18, 17, 23, 31, 36, 36, 23, 26, 15, 17, 20, 28, 17, 22, 13, 25, 17, 26, 20, 20
    ];
        // Not enough talking in two and a half minutes of mostly listening...
        expect(learn(real).result).toBeNull();
        // ...but as the call goes on it settles close to the Medium preset (140),
        // which is what this person had picked by hand.
        const { result } = learn([...real, ...real, ...real]);
        expect(result).toBeGreaterThanOrEqual(115);
        expect(result).toBeLessThanOrEqual(150);
    });

    test('a silent room with typing or a fan is not a voice', () => {
        // Near-zero floor with clicks and a hum well below speaking level.
        const clicks = Array.from({ length: 400 }, (_, i) => (i % 4 === 0 ? 9 + (i % 7) : i % 3));
        expect(learn(clicks).result).toBeNull();
        // Other people's voices from the speakers, quieter than someone at the mic.
        const bleed = [...room(40), ...talk(21, 200)];
        expect(learn(bleed).result).toBeNull();
        // And once the person does speak, it still learns from them.
        expect(learn([...bleed, ...talk(55, 60)]).result).toBeGreaterThan(110);
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

describe('presence (listen only during calls)', () => {
    const on = { supported: true, app: 'Zoom' };
    const off = { supported: true, app: null };

    test('is never idle unless the setting is on and the Mac can detect calls', () => {
        const presence = createPresence({ graceMs: 0 });
        expect(presence.update({ reading: off, onlyDuringCalls: false, now: 0 }).idle).toBe(false);
        expect(presence.update({ reading: { supported: false, app: null }, onlyDuringCalls: true, now: 0 })).toEqual(
            { supported: false, known: true, app: null, idle: false });
    });

    test('goes idle with no call, and wakes the moment one starts', () => {
        const presence = createPresence({ graceMs: 0 });
        expect(presence.update({ reading: off, onlyDuringCalls: true, now: 0 }).idle).toBe(true);
        expect(presence.update({ reading: on, onlyDuringCalls: true, now: 1000 })).toEqual(
            { supported: true, known: true, app: 'Zoom', idle: false });
    });

    test('waits out the grace period before hiding, so a mute does not blink the orb', () => {
        const presence = createPresence({ graceMs: 45000 });
        presence.update({ reading: on, onlyDuringCalls: true, now: 0 });
        expect(presence.update({ reading: off, onlyDuringCalls: true, now: 10000 }).idle).toBe(false);
        expect(presence.update({ reading: on, onlyDuringCalls: true, now: 20000 }).idle).toBe(false);
        expect(presence.update({ reading: off, onlyDuringCalls: true, now: 60000 }).idle).toBe(false); // 40s since last seen
        expect(presence.update({ reading: off, onlyDuringCalls: true, now: 66000 }).idle).toBe(true);
    });

    test('a failed reading changes nothing', () => {
        const presence = createPresence({ graceMs: 0 });
        expect(presence.update({ reading: null, onlyDuringCalls: true, now: 0 })).toEqual(
            { supported: false, known: false, app: null, idle: false });
        presence.update({ reading: off, onlyDuringCalls: true, now: 1000 });
        // Idle, then the helper times out: still idle, still supported.
        expect(presence.update({ reading: null, onlyDuringCalls: true, now: 2000 })).toEqual(
            { supported: true, known: true, app: null, idle: true });
        presence.update({ reading: on, onlyDuringCalls: true, now: 3000 });
        expect(presence.update({ reading: null, onlyDuringCalls: true, now: 4000 }).app).toBe('Zoom');
    });
});

describe('update error messages', () => {
    test('a half-published release is not blamed on the internet', () => {
        const real = new Error('Cannot find latest-mac.yml in the latest release artifacts '
            + '(https://github.com/benjscohen/sound_meter/releases/download/v1.4.0/latest-mac.yml): HttpError: 404');
        expect(describeUpdateError(real)).toBe('A new version is being published right now. Try again in a few minutes.');
    });

    test('real connection problems say so', () => {
        expect(describeUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toMatch(/internet connection/);
        expect(describeUpdateError(new Error('getaddrinfo ENOTFOUND github.com'))).toMatch(/internet connection/);
    });

    test('anything else gets an honest, non-specific message', () => {
        expect(describeUpdateError(new Error('HttpError: 403 rate limit exceeded'))).toMatch(/busy/);
        expect(describeUpdateError(new Error('ZIP file is corrupt'))).toMatch(/Something went wrong/);
        expect(describeUpdateError(null)).toMatch(/Something went wrong/);
        expect(describeUpdateError('plain string')).toMatch(/Something went wrong/);
    });
});
