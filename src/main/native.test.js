const fs = require('fs');
const os = require('os');
const path = require('path');
const { createNative, resolveMicApp, cleanEvents } = require('./native');

const OWN = ['com.benjscohen.soundmeter', 'com.github.electron'];

describe('resolveMicApp', () => {
    test('ignores Sound Meter itself', () => {
        expect(resolveMicApp([{ bundleId: 'com.benjscohen.soundmeter.helper', name: 'Sound Meter' }], OWN)).toBeNull();
        expect(resolveMicApp([{ bundleId: 'com.github.Electron.helper', name: 'Electron' }], OWN)).toBeNull();
    });

    test('recognises call apps, including their helper processes', () => {
        expect(resolveMicApp([{ bundleId: 'us.zoom.xos' }], OWN)).toBe('Zoom');
        expect(resolveMicApp([{ bundleId: 'com.microsoft.teams2.helper' }], OWN)).toBe('Microsoft Teams');
        expect(resolveMicApp([{ bundleId: 'com.google.Chrome.helper', name: 'Google Chrome' }], OWN)).toBe('Browser call');
        expect(resolveMicApp([{ bundleId: 'com.apple.WebKit.GPU' }], OWN)).toBe('Browser call');
    });

    test('prefers a known call app over anything else using the mic', () => {
        const apps = [
            { bundleId: 'com.granola.app', name: 'Granola' },
            { bundleId: 'com.benjscohen.soundmeter.helper', name: 'Sound Meter' },
            { bundleId: 'us.zoom.xos', name: 'zoom.us' }
        ];
        expect(resolveMicApp(apps, OWN)).toBe('Zoom');
    });

    test('falls back to another regular app by name, never a nameless service', () => {
        expect(resolveMicApp([{ bundleId: 'com.granola.app', name: 'Granola' }], OWN)).toBe('Granola');
        expect(resolveMicApp([{ bundleId: 'com.apple.corespeechd' }], OWN)).toBeNull();
    });

    test('tolerates junk', () => {
        expect(resolveMicApp(null)).toBeNull();
        expect(resolveMicApp([null, {}, { bundleId: 5 }])).toBeNull();
    });
});

describe('cleanEvents', () => {
    test('drops invalid events, tidies fields and sorts by start', () => {
        const events = cleanEvents([
            { title: ' Sync ', start: 200, end: 300, people: ['Maya', 'Maya', ' ', 7] },
            { title: '', start: 100, end: 150 },
            { title: 'Backwards', start: 300, end: 200 },
            { title: 'No times' },
            null
        ]);
        expect(events).toEqual([
            { title: 'Untitled event', start: 100, end: 150, people: [] },
            { title: 'Sync', start: 200, end: 300, people: ['Maya'] }
        ]);
        expect(cleanEvents('nope')).toEqual([]);
    });
});

describe('createNative with the helper', () => {
    const helperPath = __filename; // Any file that exists
    const replying = (reply) => (file, args, options, callback) => callback(null, JSON.stringify(reply(args)));

    test('asks the helper and interprets its answers', async () => {
        const calls = [];
        const native = createNative({
            helperPath,
            ownBundleIds: OWN,
            run: replying((args) => {
                calls.push(args);
                if (args[0] === 'mic-apps') return { supported: true, apps: [{ bundleId: 'us.zoom.xos' }] };
                if (args[0] === 'calendar-status') return { status: 'granted' };
                if (args[0] === 'calendar-request') return { status: 'denied' };
                return { status: 'granted', events: [{ title: 'Sync', start: 1000, end: 2000, people: ['Maya'] }] };
            })
        });

        expect(native.available).toBe(true);
        expect(await native.micApp()).toBe('Zoom');
        expect(await native.calendarStatus()).toBe('granted');
        expect(await native.calendarRequest()).toBe('denied');
        expect(await native.calendarEvents(500.4, 2500.2)).toEqual([{ title: 'Sync', start: 1000, end: 2000, people: ['Maya'] }]);
        expect(calls.at(-1)).toEqual(['calendar-events', '500', '2501']);
    });

    test('degrades quietly when the helper fails or talks nonsense', async () => {
        const failing = createNative({ helperPath, run: (f, a, o, callback) => callback(new Error('boom')) });
        expect(await failing.micApp()).toBeNull();
        expect(await failing.calendarStatus()).toBe('unavailable');
        expect(await failing.calendarEvents(0, 10)).toEqual([]);

        const garbled = createNative({ helperPath, run: (f, a, o, callback) => callback(null, 'not json') });
        expect(await garbled.calendarStatus()).toBe('unavailable');
        expect(await garbled.calendarRequest()).toBe('unavailable');
    });

    test('is unavailable, and never runs anything, without a helper binary', async () => {
        const run = jest.fn();
        const native = createNative({ helperPath: '/nowhere/sm-helper', run });
        expect(native.available).toBe(false);
        expect(await native.micApp()).toBeNull();
        expect(await native.calendarStatus()).toBe('unavailable');
        expect(run).not.toHaveBeenCalled();
    });
});

describe('createNative with fixtures', () => {
    test('serves fixture data and models the permission prompt', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-meter-native-'));
        const fixturesPath = path.join(dir, 'fixtures.json');
        fs.writeFileSync(fixturesPath, JSON.stringify({
            micApps: [{ bundleId: 'com.apple.FaceTime' }],
            calendar: {
                status: 'not-determined',
                statusAfterRequest: 'granted',
                events: [
                    { title: 'In range', start: 1000, end: 2000, people: [] },
                    { title: 'Out of range', start: 9000, end: 9500, people: [] }
                ]
            }
        }));

        const native = createNative({ fixturesPath, ownBundleIds: OWN });
        expect(native.available).toBe(true);
        expect(await native.micApp()).toBe('FaceTime');
        expect(await native.calendarStatus()).toBe('not-determined');
        expect(await native.calendarEvents(0, 5000)).toEqual([]);
        expect(await native.calendarRequest()).toBe('granted');
        expect((await native.calendarEvents(0, 5000)).map((e) => e.title)).toEqual(['In range']);

        fs.rmSync(dir, { recursive: true, force: true });
    });
});
