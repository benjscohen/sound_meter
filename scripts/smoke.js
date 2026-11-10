// End-to-end smoke test. Boots the real app against a throwaway profile and
// a fake microphone, walks through onboarding, the meter and Insights, saves
// a screenshot of each, and fails if any window logs an error.
//
//   npm run smoke            (screenshots land in ./shots)
//   SMOKE_THEME=dark npm run smoke
//
// Loaded with `electron -r ./scripts/smoke.js .` so it runs before main.js.
const { app, clipboard, dialog, ipcMain, nativeTheme, shell, BrowserWindow, Menu, ShareMenu } = require('electron');
const fs = require('fs');
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const { createHistory, localDate } = require('../src/main/history');

const out = path.resolve(process.env.SMOKE_OUT || 'shots');
const theme = process.env.SMOKE_THEME || 'light';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-meter-smoke-'));
const problems = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.setPath('userData', profile);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
nativeTheme.themeSource = theme;
fs.mkdirSync(out, { recursive: true });

// Auto-confirm the "Delete all history?" dialog.
dialog.showMessageBox = async () => ({ response: 0 });

// Things that would otherwise reach outside the test: record them instead of
// popping up menus or overwriting the real clipboard.
const outside = { menus: 0, shared: 0, image: null, text: null, opened: [] };
Menu.prototype.popup = function popup() { outside.menus += 1; };
ShareMenu.prototype.popup = function popup() { outside.shared += 1; };
clipboard.writeImage = (image) => { outside.image = image.getSize(); };
clipboard.writeText = (value) => { outside.text = value; };
shell.openExternal = async (url) => { outside.opened.push(url); };
dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(profile, 'saved-card.png') });

// The working day used for both the seeded history and the fake calendar:
// [title, start, end, app in use, how animated it gets, attendees].
const SCHEDULE = [
    ['Weekly sync', [9, 0], [9, 45], 'Zoom', 1.0, ['Maya Patel', 'Jordan Lee']],
    ['Design review', [10, 0], [11, 0], 'Zoom', 1.25, ['Sam Rivera', 'Maya Patel', 'Chris Wong']],
    ['1:1 with Sam', [13, 5], [13, 35], 'Browser call', 0.55, ['Sam Rivera']],
    ['Customer call', [15, 0], [15, 45], 'Browser call', 1.5, ['Dana Kim']],
    [null, [16, 0], [16, 40], null, 0.8, []] // Heads-down time, no meeting
];

const seededDays = [];
for (let daysAgo = 13; daysAgo >= 0; daysAgo--) {
    const day = new Date();
    day.setDate(day.getDate() - daysAgo);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    if (!weekend || daysAgo === 0) seededDays.push(day); // Weekends off (but always seed today)
}
const clock = (day, [hours, minutes]) => new Date(day).setHours(hours, minutes, 0, 0);

// Two weeks of believable history, so Insights has something to show.
function seedHistory() {
    const history = createHistory(path.join(profile, 'history'));
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    for (const day of seededDays) {
        const rowdiness = 0.6 + random() * 0.9;
        for (const [, from, to, appName, energy] of SCHEDULE) {
            const end = Math.min(clock(day, to), Date.now());
            let mood = 0.25;
            for (let t = clock(day, from); t < end; t += 1000) {
                if ((t / 1000) % 45 === 0) mood = 0.1 + random() * 0.42 * rowdiness * energy;
                const excited = Math.sin(t / 420000) > 0.86 ? 0.4 * rowdiness * energy : 0;
                const avg = Math.max(0, mood + excited + (random() - 0.5) * 0.18);
                history.record({ avg, peak: avg + random() * 0.3 }, t, { app: appName });
            }
        }
    }
    history.flush();
}

// Stand-ins for the native helper: a calendar that grants access when asked,
// and Zoom holding the microphone.
function writeFixtures() {
    const events = seededDays.flatMap((day) => SCHEDULE
        .filter(([title]) => title)
        .map(([title, from, to, , , people]) => ({ title, start: clock(day, from), end: clock(day, to), people })));
    const file = path.join(profile, 'fixtures.json');
    fs.writeFileSync(file, JSON.stringify({
        micApps: [{ bundleId: 'us.zoom.xos', name: 'zoom.us' }, { bundleId: 'com.github.Electron.helper', name: 'Electron' }],
        calendar: { status: 'not-determined', statusAfterRequest: 'granted', events }
    }));
    process.env.SOUND_METER_FIXTURES = file;
}

async function shoot(win, name) {
    await wait(350);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `${theme}-${name}.png`), image.toPNG());
    console.log(`  ✓ ${name}`);
}

function find(file) {
    return BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith(file));
}

async function until(check, label, timeout = 8000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
        const value = await check();
        if (value) return value;
        await wait(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
}

const js = (win, code) => win.webContents.executeJavaScript(code, true);

app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', (_e, level, message, line, source) => {
        if (level >= 2) problems.push(`${path.basename(source)}:${line} ${message}`);
    });
    contents.on('render-process-gone', (_e, details) => problems.push(`renderer gone: ${details.reason}`));
    contents.on('preload-error', (_e, file, error) => problems.push(`preload error: ${error.message}`));
});

// The real native helper, where it has been built: its read-only commands
// must answer with well-formed JSON (neither asks for any permission).
function checkHelper() {
    const helper = path.join(__dirname, '..', 'native', 'bin', 'sm-helper');
    if (!fs.existsSync(helper)) {
        console.log('  - native helper not built, skipping its check (npm run build:helper)');
        return;
    }
    const ask = (...args) => JSON.parse(execFileSync(helper, args, { timeout: 10000, encoding: 'utf8' }));
    const mic = ask('mic-apps');
    if (typeof mic.supported !== 'boolean' || !Array.isArray(mic.apps)) throw new Error('Helper mic-apps reply is malformed');
    if (mic.apps.some((entry) => typeof entry.bundleId !== 'string')) throw new Error('Helper mic-apps entries need a bundleId');
    const { status } = ask('calendar-status');
    if (!['granted', 'denied', 'restricted', 'not-determined'].includes(status)) throw new Error(`Unexpected calendar status: ${status}`);
    const events = ask('calendar-events', '0', '1');
    if (!Array.isArray(events.events)) throw new Error('Helper calendar-events reply is malformed');
    console.log(`  ✓ native helper (calendar: ${status}, mic apps supported: ${mic.supported})`);
}

async function run() {
    checkHelper();

    /* ---- First run: onboarding ---------------------------------------- */
    const welcome = await until(() => find('onboarding.html'), 'welcome window');
    await until(() => js(welcome, `document.querySelector('.step.active') !== null`), 'welcome content');
    if (find('index.html')) throw new Error('Meter should not appear before onboarding finishes');
    await wait(900);
    await shoot(welcome, '1-welcome');

    await js(welcome, `document.getElementById('primary').click()`);
    await until(() => js(welcome, `document.getElementById('wizard').dataset.step === '1'`), 'mic step');
    await wait(500);
    await shoot(welcome, '2-microphone');

    // Don't trigger the real macOS permission prompt in a smoke test.
    await js(welcome, `document.getElementById('secondary').click()`);
    await until(() => js(welcome, `document.getElementById('wizard').dataset.step === '2'`), 'calibrate step');
    await js(welcome, `document.querySelectorAll('#sensitivity button')[2].click()`);
    await wait(500);
    await shoot(welcome, '3-calibrate');

    await js(welcome, `document.getElementById('primary').click()`);
    await until(() => js(welcome, `document.getElementById('wizard').dataset.step === '3'`), 'done step');
    await wait(500);
    await shoot(welcome, '4-done');

    await js(welcome, `document.getElementById('launch-at-login').checked = false; document.getElementById('primary').click()`);

    /* ---- Meter ---------------------------------------------------------- */
    const meter = await until(() => find('index.html'), 'meter window');
    await until(() => !find('onboarding.html'), 'welcome window to close');
    const state = await until(
        () => js(meter, `window.soundMeter.getState().then((s) => s.settings.onboarded && s)`), 'onboarded state');
    if (state.settings.sensitivity !== 210) throw new Error(`Sensitivity not saved (got ${state.settings.sensitivity})`);

    await until(() => js(meter, `document.getElementById('stage').dataset.state === 'listening'`), 'meter to start listening');
    await wait(1200);
    await shoot(meter, '5-meter');

    // The fake microphone beeps, so within a few seconds the orb must have moved.
    const moved = await until(
        () => js(meter, `parseFloat(getComputedStyle(document.getElementById('orb')).getPropertyValue('--s')) > 1.02`),
        'orb to react to sound', 12000);
    if (!moved) throw new Error('Orb never reacted');
    await shoot(meter, '6-meter-active');

    // Hovering the orb reveals an explicit Options button that opens the menu.
    await js(meter, `document.getElementById('orb').dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))`);
    await until(() => js(meter, `document.getElementById('stage').classList.contains('hover')
        && getComputedStyle(document.getElementById('options')).opacity === '1'`), 'Options button on hover');
    await shoot(meter, '6b-meter-hover');
    await js(meter, `document.getElementById('options').click()`);
    await until(() => outside.menus === 1, 'Options button to open the menu');
    await js(meter, `document.dispatchEvent(new MouseEvent('mouseleave'))`);
    await until(() => js(meter, `!document.getElementById('stage').classList.contains('hover')`), 'hover to end');

    // Pause from "the menu" (same code path: a settings update).
    await js(meter, `window.soundMeter.updateSettings({ paused: true })`);
    await until(() => js(meter, `document.getElementById('stage').dataset.state === 'paused'`), 'paused state');
    await shoot(meter, '7-meter-paused');
    await js(meter, `window.soundMeter.updateSettings({ paused: false })`);
    await until(() => js(meter, `document.getElementById('stage').dataset.state === 'listening'`), 'resume');

    // Dragging moves the window and the position is remembered.
    const [x0, y0] = meter.getPosition();
    ipcMain.emit('meter:drag-start', {});
    ipcMain.emit('meter:drag-move', {}, -120, 80);
    ipcMain.emit('meter:drag-end', {});
    const [x1, y1] = meter.getPosition();
    if (x1 !== x0 - 120 || y1 !== y0 + 80) throw new Error(`Drag failed: ${x0},${y0} -> ${x1},${y1}`);
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
    if (saved.position.x !== x1 || saved.position.y !== y1) throw new Error('Position was not saved');

    // Samples from the fake mic should be reaching history.
    await until(() => js(meter, `window.soundMeter.listDays(1).then((d) => d.length > 0 && d[0].seconds >= 2)`),
        'samples to reach history', 10000);

    /* ---- Insights: Day -------------------------------------------------- */
    const text = (selector) => js(insights, `[...document.querySelectorAll(${JSON.stringify(selector)})].map((n) => n.textContent.trim())`);
    const visible = (id) => js(insights, `!document.getElementById(${JSON.stringify(id)}).hidden`);
    const scrollTo = (id) => js(insights, `document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'start' })`);

    ipcMain.emit('insights:open', {});
    const insights = await until(() => find('insights.html'), 'insights window');
    await until(() => js(insights, `document.querySelectorAll('.day:not(:disabled)').length > 5`), 'seeded days');
    await until(() => js(insights, `document.querySelectorAll('#chart-svg path.avg').length > 0`), 'chart');
    if ((await text('#day-metrics .metric')).length !== 4) throw new Error('Day metrics missing');
    await wait(600);
    await shoot(insights, '8-insights-day');

    const yesterday = await js(insights, `(() => {
        const days = [...document.querySelectorAll('.day:not(:disabled)')];
        days[days.length - 2].click();
        return true;
    })()`);
    if (!yesterday) throw new Error('Could not select a previous day');
    await until(() => js(insights, `document.getElementById('chart-title').textContent !== 'Today'`), 'day switch');
    await js(insights, `(() => {
        const svg = document.getElementById('chart-svg');
        const box = svg.getBoundingClientRect();
        svg.dispatchEvent(new MouseEvent('mousemove', { clientX: box.left + box.width * 0.12, clientY: box.top + 80, bubbles: true }));
    })()`);
    if (await js(insights, `document.getElementById('tooltip').hidden`)) throw new Error('Chart tooltip did not appear');
    if (!(await text('#tooltip'))[0].includes('Zoom')) throw new Error('Tooltip should name the call app');

    // Apps need no permission, so the "Where" card is there from the start.
    const apps = await text('#day-apps .row-label');
    if (!apps.includes('Zoom') || !apps.includes('Browser call')) throw new Error(`Unexpected apps: ${apps}`);

    // Meetings are opt-in: first an invitation, then (once allowed) the list.
    if ((await text('#day-meetings .row')).length) throw new Error('Meetings shown before calendar was connected');
    await js(insights, `document.querySelector('#day-meetings #connect-calendar').click()`);
    await until(async () => (await text('#day-meetings .row-label')).length >= 4, 'meetings after connecting calendar');
    const meetings = await text('#day-meetings .row-label');
    if (meetings.join('|') !== 'Weekly sync|Design review|1:1 with Sam|Customer call') throw new Error(`Unexpected meetings: ${meetings}`);
    if (!JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).calendar) throw new Error('Calendar opt-in was not saved');
    await scrollTo('chart');
    await shoot(insights, '9-insights-day-meetings');

    // The app on the (fake) call is detected, so live samples get credited to it.
    await until(() => js(meter, `window.soundMeter.getState().then((s) => s.micApp === 'Zoom')`), 'call app detection', 15000);

    /* ---- Insights: Trends ------------------------------------------------ */
    await js(insights, `document.querySelector('#tabs [data-view="trends"]').click()`);
    await until(() => visible('view-trends'), 'trends view');
    await until(async () => (await text('#trend-metrics .metric')).length === 4, 'trend metrics');
    await until(() => js(insights, `document.querySelectorAll('.heat-cell.on').length >= 20`), 'heatmap');
    if (!(await text('#heatmap-sub'))[0].startsWith('You’re loudest on')) throw new Error('Heatmap headline missing');

    const trendMeetings = await text('#trend-meetings .row-label');
    if (trendMeetings[0] !== 'Customer call' || trendMeetings.at(-1) !== '1:1 with Sam') {
        throw new Error(`Meetings should rank loudest first: ${trendMeetings}`);
    }
    const sessions = (await text('#trend-meetings .row-sub'))[0];
    if (!/^\d+ sessions · /.test(sessions)) throw new Error(`Repeats should roll up: ${sessions}`);
    const people = await text('#trend-people .row-label');
    if (people[0] !== 'Dana Kim' || !people.includes('Sam Rivera')) throw new Error(`Unexpected people: ${people}`);
    if (!(await text('#trend-apps .row-label')).includes('No call app')) throw new Error('Trends apps missing');
    if (await visible('view-day')) throw new Error('Day view should be hidden on Trends');
    await wait(500);
    await shoot(insights, '10-insights-trends');
    await scrollTo('trend-meetings');
    await shoot(insights, '11-insights-trends-lists');

    // Share: a card of the week's totals and a link that unfurls to it.
    await js(insights, `window.scrollTo(0, 0)`);
    await js(insights, `document.getElementById('share').click()`);
    await until(() => js(insights, `document.getElementById('share-dialog').open`), 'share dialog');
    const link = (await text('#share-url'))[0];
    if (!/^shhh\.it\.com\/s\?c=\d+&l=\d+&m=\d+&s=\d+&a=\d+&d=\d&h=\d+$/.test(link)) throw new Error(`Odd share link: ${link}`);
    const painted = await js(insights, `(() => {
        const { data, width } = document.getElementById('share-canvas').getContext('2d').getImageData(0, 0, 1200, 630);
        const pixel = (x, y) => data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4);
        const [orb, corner] = [pixel(980, 290), pixel(600, 20)];
        return orb[3] === 255 && Math.abs(orb[0] - corner[0]) + Math.abs(orb[2] - corner[2]) > 40;
    })()`);
    if (!painted) throw new Error('Share card was not drawn');

    await js(insights, `document.getElementById('share-copy-link').click()`);
    await until(() => outside.text === `https://${link}`, 'share link to be copied');
    await until(async () => (await text('#share-status.show'))[0] === 'Link copied', 'copy confirmation');
    await shoot(insights, '12-insights-share');

    await js(insights, `document.getElementById('share-copy-image').click()`);
    await until(() => outside.image, 'share card to be copied');
    if (outside.image.width !== 1200 || outside.image.height !== 630) throw new Error('Copied card has the wrong size');

    await js(insights, `document.getElementById('share-save').click()`);
    const savedCard = path.join(profile, 'saved-card.png');
    await until(() => fs.existsSync(savedCard) && fs.readFileSync(savedCard).subarray(1, 4).toString() === 'PNG', 'card to be saved');

    // Each "Post to" button opens that service's compose page with the link.
    const chips = await js(insights, `[...document.querySelectorAll('#share-destinations [data-destination]')].map((c) => c.dataset.destination)`);
    if (chips.join() !== 'x,linkedin,threads,bluesky,whatsapp,email') throw new Error(`Unexpected destinations: ${chips}`);
    for (const key of chips) await js(insights, `document.querySelector('[data-destination="${key}"]').click()`);
    await until(() => outside.opened.length === chips.length, 'compose pages to open');
    const encoded = encodeURIComponent(`https://${link}`);
    const stray = outside.opened.find((url) => !decodeURIComponent(url.replace(/\+/g, ' ')).includes(`https://${link}`));
    if (stray) throw new Error(`Compose page without the link: ${stray} (${encoded})`);
    if (!outside.opened[0].startsWith('https://x.com/intent/post?')) throw new Error(`Unexpected X url: ${outside.opened[0]}`);

    await js(insights, `document.getElementById('share-more').click()`);
    await until(() => outside.shared === 1, 'share sheet');
    await js(insights, `document.getElementById('share-close').click()`);
    if (await js(insights, `document.getElementById('share-dialog').open`)) throw new Error('Share dialog did not close');

    insights.setSize(740, 600);
    await wait(500);
    await shoot(insights, '12b-insights-trends-narrow');
    insights.setSize(980, 720);

    // Turning the calendar off (as the menu does) puts the invitation back.
    await js(insights, `window.soundMeter.disconnectCalendar()`);
    await until(async () => (await text('#trend-meetings #connect-calendar')).length === 1, 'calendar invitation to return');
    if (await visible('trend-people')) throw new Error('People should hide without calendar access');

    await js(insights, `document.querySelector('#tabs [data-view="day"]').click()`);
    await until(() => visible('view-day'), 'day view');

    // Clearing history (confirmation auto-accepted above) shows the empty state.
    await js(meter, `window.soundMeter.updateSettings({ paused: true })`);
    await wait(1200);
    await js(insights, `document.getElementById('clear').click()`);
    await until(() => js(insights, `!document.getElementById('empty').hidden`), 'empty state');
    if (fs.readdirSync(path.join(profile, 'history')).length) throw new Error('History files were not deleted');
    await wait(400);
    if (await visible('tabs')) throw new Error('Tabs should hide with no history');
    await shoot(insights, '13-insights-empty');
}

seedHistory();
writeFixtures();

app.whenReady().then(async () => {
    let failed = false;
    try {
        await run();
    } catch (error) {
        failed = true;
        console.error(`  ✗ ${error.message}`);
    }
    if (problems.length) {
        failed = true;
        console.error('Console errors:\n  ' + [...new Set(problems)].join('\n  '));
    }
    console.log(failed ? 'SMOKE FAILED' : 'SMOKE PASSED');
    fs.rmSync(profile, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
});
