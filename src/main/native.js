const fs = require('fs');
const { execFile } = require('child_process');

// Apps we recognise as "a call", most specific first. Matched as a
// case-insensitive prefix of the bundle identifier using the microphone.
const KNOWN_APPS = [
    ['us.zoom.xos', 'Zoom'],
    ['com.microsoft.teams', 'Microsoft Teams'],
    ['com.apple.facetime', 'FaceTime'],
    ['com.apple.avconferenced', 'FaceTime'],
    ['com.cisco.webex', 'Webex'],
    ['cisco-systems.spark', 'Webex'],
    ['com.tinyspeck.slackmacgap', 'Slack'],
    ['com.hnc.discord', 'Discord'],
    ['net.whatsapp.whatsapp', 'WhatsApp'],
    ['com.google.chrome', 'Browser call'],
    ['com.apple.safari', 'Browser call'],
    ['com.apple.webkit', 'Browser call'],
    ['company.thebrowser.browser', 'Browser call'],
    ['com.microsoft.edgemac', 'Browser call'],
    ['org.mozilla.firefox', 'Browser call'],
    ['com.brave.browser', 'Browser call']
];

const CALENDAR_STATES = ['granted', 'denied', 'restricted', 'not-determined'];

/**
 * Picks the one app to credit for the current moment from everything that is
 * using a microphone: a known call app if there is one, otherwise any other
 * regular app, never Sound Meter itself or background system services.
 */
function resolveMicApp(apps, ownPrefixes = []) {
    if (!Array.isArray(apps)) return null;
    const own = ownPrefixes.map((p) => p.toLowerCase());
    const others = apps
        .filter((app) => app && typeof app.bundleId === 'string')
        .map((app) => ({ id: app.bundleId.toLowerCase(), name: typeof app.name === 'string' ? app.name.trim() : '' }))
        .filter((app) => !own.some((prefix) => app.id.startsWith(prefix)));

    for (const [prefix, label] of KNOWN_APPS) {
        if (others.some((app) => app.id.startsWith(prefix))) return label;
    }
    const named = others.find((app) => app.name);
    return named ? named.name : null;
}

function cleanEvents(events) {
    if (!Array.isArray(events)) return [];
    return events
        .filter((e) => e && Number.isFinite(e.start) && Number.isFinite(e.end) && e.end > e.start)
        .map((e) => ({
            title: typeof e.title === 'string' && e.title.trim() ? e.title.trim() : 'Untitled event',
            start: e.start,
            end: e.end,
            people: Array.isArray(e.people) ? [...new Set(e.people.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim()))] : []
        }))
        .sort((a, b) => a.start - b.start);
}

/**
 * Access to the things Electron can't see: which app is on a call, and the
 * user's calendar. Backed by the bundled sm-helper binary, or by a JSON
 * fixture file in tests. Every method resolves (never rejects) with a safe
 * default, so a missing or broken helper only hides features.
 */
function createNative({ helperPath, fixturesPath = null, ownBundleIds = [], run = execFile } = {}) {
    const fixtures = fixturesPath ? JSON.parse(fs.readFileSync(fixturesPath, 'utf8')) : null;
    const available = !!fixtures || (!!helperPath && fs.existsSync(helperPath));

    function helper(args, timeout = 5000) {
        return new Promise((resolve) => {
            if (!available) return resolve(null);
            run(helperPath, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
                if (error) return resolve(null);
                try {
                    const parsed = JSON.parse(stdout);
                    resolve(parsed && typeof parsed === 'object' ? parsed : null);
                } catch {
                    resolve(null);
                }
            });
        });
    }

    const status = (value) => (CALENDAR_STATES.includes(value) ? value : 'unavailable');

    /**
     * Who is on a call: { supported, app }. `supported` is false where macOS
     * can't say which apps are using a microphone (before 14.2).
     */
    async function micState() {
        let result;
        if (fixtures) {
            // Re-read each time so a test can start and end a "call".
            const live = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
            result = { supported: live.micSupported !== false, apps: live.micApps };
        } else {
            result = await helper(['mic-apps']);
        }
        const supported = !!(result && result.supported);
        return { supported, app: supported ? resolveMicApp(result.apps, ownBundleIds) : null };
    }

    async function calendarStatus() {
        if (fixtures) return status(fixtures.calendar && fixtures.calendar.status);
        const result = await helper(['calendar-status']);
        return status(result && result.status);
    }

    async function calendarRequest() {
        if (fixtures) {
            if (fixtures.calendar) fixtures.calendar.status = fixtures.calendar.statusAfterRequest || fixtures.calendar.status;
            return calendarStatus();
        }
        // Waits on a system permission dialog, so allow plenty of time.
        const result = await helper(['calendar-request'], 130000);
        return status(result && result.status);
    }

    async function calendarEvents(from, to) {
        if (!(to > from)) return [];
        if (fixtures) {
            if (await calendarStatus() !== 'granted') return [];
            return cleanEvents(fixtures.calendar.events).filter((e) => e.end > from && e.start < to);
        }
        const result = await helper(['calendar-events', String(Math.floor(from)), String(Math.ceil(to))], 15000);
        return cleanEvents(result && result.events);
    }

    return { available, micState, calendarStatus, calendarRequest, calendarEvents };
}

module.exports = { createNative, resolveMicApp, cleanEvents, KNOWN_APPS };
