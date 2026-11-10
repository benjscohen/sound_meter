// End-to-end smoke test. Boots the real app against a throwaway profile and
// a fake microphone, walks through onboarding, the meter and Insights, saves
// a screenshot of each, and fails if any window logs an error.
//
//   npm run smoke            (screenshots land in ./shots)
//   SMOKE_THEME=dark npm run smoke
//
// Loaded with `electron -r ./scripts/smoke.js .` so it runs before main.js.
const { app, dialog, ipcMain, nativeTheme, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHistory } = require('../src/main/history');

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

// Two weeks of believable history, so Insights has something to show.
function seedHistory() {
    const history = createHistory(path.join(profile, 'history'));
    const now = new Date();
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    for (let daysAgo = 12; daysAgo >= 0; daysAgo--) {
        if (daysAgo === 5 || daysAgo === 6) continue; // A weekend off
        const day = new Date(now);
        day.setDate(day.getDate() - daysAgo);
        const rowdiness = 0.6 + random() * 0.9;
        const blocks = [[9, 0, 11, 40], [13, 5, 14, 30], [15, 0, 16 + (daysAgo % 2), 45]];

        for (const [h0, m0, h1, m1] of blocks) {
            const start = new Date(day).setHours(h0, m0, 0, 0);
            const end = Math.min(new Date(day).setHours(h1, m1, 0, 0), now.getTime());
            let mood = 0.25;
            for (let t = start; t < end; t += 1000) {
                if ((t / 1000) % 45 === 0) mood = 0.12 + random() * 0.5 * rowdiness;
                const excited = Math.sin(t / 420000) > 0.86 ? 0.45 * rowdiness : 0;
                const avg = Math.max(0, mood + excited + (random() - 0.5) * 0.18);
                history.record({ avg, peak: avg + random() * 0.3 }, t);
            }
        }
    }
    history.flush();
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

async function run() {
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

    /* ---- Insights ------------------------------------------------------- */
    ipcMain.emit('insights:open', {});
    const insights = await until(() => find('insights.html'), 'insights window');
    await until(() => js(insights, `document.querySelectorAll('.day:not(:disabled)').length > 5`), 'seeded days');
    await until(() => js(insights, `document.querySelectorAll('#chart-svg path.avg').length > 0`), 'chart');
    await wait(600);
    await shoot(insights, '8-insights');

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
        svg.dispatchEvent(new MouseEvent('mousemove', { clientX: box.left + box.width * 0.42, clientY: box.top + 80, bubbles: true }));
    })()`);
    if (await js(insights, `document.getElementById('tooltip').hidden`)) throw new Error('Chart tooltip did not appear');
    await shoot(insights, '9-insights-previous-day');

    insights.setSize(740, 600);
    await wait(500);
    await shoot(insights, '10-insights-narrow');
    insights.setSize(980, 720);

    // Clearing history (confirmation auto-accepted above) shows the empty state.
    await js(meter, `window.soundMeter.updateSettings({ paused: true })`);
    await wait(1200);
    await js(insights, `document.getElementById('clear').click()`);
    await until(() => js(insights, `!document.getElementById('empty').hidden`), 'empty state');
    if (fs.readdirSync(path.join(profile, 'history')).length) throw new Error('History files were not deleted');
    await wait(400);
    await shoot(insights, '11-insights-empty');
}

seedHistory();

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
