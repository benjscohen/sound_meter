const {
    app, BrowserWindow, screen, Tray, Menu, nativeImage, ipcMain,
    systemPreferences, shell, dialog, clipboard, ShareMenu, Notification, powerMonitor
} = require('electron');
const fs = require('fs');
const path = require('path');
const { createSettings, supportsVoiceFocus } = require('./src/main/settings');
const { createHistory } = require('./src/main/history');
const { createNative } = require('./src/main/native');
const analytics = require('./src/main/analytics');
const { prepareShare, destinationUrl } = require('./src/main/share');
const { createCalibrator } = require('./src/main/calibration');
const { createNudger, recapDue } = require('./src/main/reminders');
const { createPresence } = require('./src/main/presence');
const { describeUpdateError } = require('./src/main/update-errors');
const { shouldOfferMove, moveToApplications } = require('./src/main/install');
const { nearestArea, clampCentre, resolveCentre, roomAround } = require('./src/main/placement');
const { CONSTANTS } = require('./src/utils/audio-visualizer');

// A released build refuses Chromium's remote-debugging switches. Left on,
// any program on this Mac could drive the app and borrow the microphone and
// system-audio access the user gave it. (The Node-side equivalents are
// switched off at build time: see electronFuses in package.json.)
if (app.isPackaged) {
    for (const name of ['remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address']) {
        app.commandLine.removeSwitch(name);
    }
}

// The orb's window is transparent and much bigger than the orb, so its glow
// and ripple have room at full size: anything reaching the edge of the
// window is cut off in a hard line. (Checked by the end-to-end test.)
const METER_SIZE = 256;
const HISTORY_RETENTION_DAYS = 90;
const TRENDS_DAYS = 28;
const MIC_APP_POLL_MS = 5 * 1000;
const HOURLY_MS = 60 * 60 * 1000;
// How long after a call app lets go of the microphone before the orb hides.
// (Overridable so the end-to-end test doesn't have to wait.)
const IDLE_GRACE_MS = Number(process.env.SOUND_METER_IDLE_GRACE_MS) || 45 * 1000;
const ORB_SIZES = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];
const ORB_OPACITIES = [[1, '100%'], [0.75, '75%'], [0.5, '50%']];
const CALENDAR_CACHE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CALENDAR_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars';
// Screen & System Audio Recording, where "System Audio Recording Only" lives.
const SYSTEM_AUDIO_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
const MIC_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
const WEBSITE_URL = 'https://shhh.it.com';
const VOICE_SUPPORTED = supportsVoiceFocus(process.platform, process.getSystemVersion());

const settings = createSettings(path.join(app.getPath('userData'), 'settings.json'));

const calibrator = createCalibrator();
const nudger = createNudger();
const presence = createPresence({ graceMs: IDLE_GRACE_MS });
const notifications = new Set(); // Kept alive until clicked or dismissed, or their click is lost
let history;
let native;
let tray = null;
let meterWindow = null;
let panelWindow = null;    // The one main window: Day, Trends and Settings
let onboardingWindow = null;
let dragOrigin = null;
let isQuitting = false;

// State that isn't persisted but that windows and menus care about.
const runtime = {
    devices: [],            // [{ id, label }] reported by the meter window
    micStatus: 'unknown',   // 'unknown' | 'granted' | 'denied' | 'no-device'
    micApp: null,           // Call app currently using a microphone, e.g. 'Zoom'
    micSupported: false,    // Whether macOS can tell us which apps use the microphone
    micKnown: false,        // Whether we have had an answer yet
    idle: false,            // "Only during calls" is on and nobody is on a call
    voice: 'off',           // Voice Focus: 'off' | 'on' | 'fallback' (wanted, but macOS won't let us hear system audio)
    voiceRetry: 0,          // Bumped to ask the meter to try Voice Focus again
    update: { status: 'idle', version: null } // idle | checking | downloading | ready
};

const webPreferences = {
    preload: path.join(__dirname, 'src', 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
};

/* ------------------------------------------------------------------ state */

// Whether to offer moving into Applications. (The end-to-end test, which
// runs unpackaged, switches the offer on to walk through it.)
const offerMove = () => process.env.SOUND_METER_OFFER_MOVE === '1' || shouldOfferMove({
    packaged: app.isPackaged,
    inApplications: app.isPackaged && app.isInApplicationsFolder(),
    declined: settings.get('declinedMove')
});

function getState() {
    return {
        settings: settings.all(),
        devices: runtime.devices,
        micStatus: runtime.micStatus,
        micApp: runtime.micApp,
        idle: runtime.idle,
        voice: runtime.voice,
        voiceRetry: runtime.voiceRetry,
        voiceSupported: VOICE_SUPPORTED,
        offerMove: offerMove(),
        update: runtime.update,
        version: app.getVersion(),
        packaged: app.isPackaged,
        status: statusLabel(),
        nativeAvailable: !!native && native.available,
        callsSupported: runtime.micSupported || !runtime.micKnown,
        launchAtLogin: getLaunchAtLogin(),
        sensitivityOptions: CONSTANTS.SENSITIVITY_OPTIONS
    };
}

function broadcastState() {
    const state = getState();
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('state:changed', state);
    }
    refreshTray();
}

function updateSettings(patch) {
    // A level learned on one microphone doesn't carry over to another.
    const before = settings.get('deviceLabel');
    const switchedMic = patch && typeof patch.deviceLabel === 'string' && before && patch.deviceLabel !== before;
    if (switchedMic && settings.get('sensitivityMode') === 'auto' && settings.get('calibrated')) {
        calibrator.reset();
        patch = { ...patch, calibrated: false, sensitivity: CONSTANTS.SENSITIVITY_PRESETS.MEDIUM };
        setImmediate(() => sendToMeter('meter:notice', 'New microphone: learning your voice…'));
    }
    // With Voice Focus the signal reads a little differently, so learn again.
    const voiceChanged = patch && 'voiceFocus' in patch && !!patch.voiceFocus !== !!settings.get('voiceFocus');
    if (voiceChanged && settings.get('sensitivityMode') === 'auto') {
        calibrator.reset();
        patch = { ...patch, calibrated: false, sensitivity: CONSTANTS.SENSITIVITY_PRESETS.MEDIUM };
    }
    if (!settings.update(patch)) return;
    broadcastState();
    if (patch && ('onlyDuringCalls' in patch || 'paused' in patch)) pollMicApp();
    if (patch && 'orbSize' in patch) placeMeter();     // A bigger orb needs more room at an edge
}

function getLaunchAtLogin() {
    try {
        return app.getLoginItemSettings().openAtLogin;
    } catch {
        return false;
    }
}

function setLaunchAtLogin(openAtLogin) {
    try {
        // Never register the bare Electron binary while developing.
        if (app.isPackaged) app.setLoginItemSettings({ openAtLogin });
    } catch (error) {
        console.error('Failed to update login item:', error);
    }
    broadcastState();
}

/* --------------------------------------------------------------- insights */

// Which call app is in use right now, so each minute of history can be
// credited to it, and so "only during calls" knows when to wake up.
// Polled, because nothing tells us when a call starts.
let hiddenWhileIdle = false;
let polling = false;
async function pollMicApp() {
    if (polling) return;
    polling = true;
    try {
        const onlyDuringCalls = settings.get('onlyDuringCalls');
        const listening = !settings.get('paused') && runtime.micStatus === 'granted';
        // Ask when the answer matters, and once at the start so we know
        // whether this Mac can tell us at all.
        const reading = onlyDuringCalls || listening || !runtime.micKnown
            ? await native.micState()
            : { supported: runtime.micSupported, app: null };
        const { supported, known, app: current, idle } = presence.update({ reading, onlyDuringCalls });
        if (current === runtime.micApp && idle === runtime.idle
            && supported === runtime.micSupported && known === runtime.micKnown) return;

        runtime.micApp = current;
        runtime.micSupported = supported;
        runtime.micKnown = known;
        runtime.idle = idle;

        // While idle the orb is out of the way and the microphone is released.
        if (meterWindow && !meterWindow.isDestroyed()) {
            if (idle && meterWindow.isVisible()) {
                hiddenWhileIdle = true;
                meterWindow.hide();
            } else if (!idle && hiddenWhileIdle) {
                hiddenWhileIdle = false;
                meterWindow.showInactive();
            }
        }
        broadcastState();
    } finally {
        polling = false;
    }
}

function notify(title, body, onClick) {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title, body, silent: true });
    // Hold on to it: a notification that has been garbage-collected can't
    // tell us it was clicked an hour later.
    notifications.add(notification);
    notification.on('click', () => {
        notifications.delete(notification);
        if (onClick) onClick();
    });
    notification.on('close', () => notifications.delete(notification));
    notification.show();
}

// Automatic sensitivity: listen to the first minute or so of talking, set
// the limit once, and stop.
function learnVoice(sample) {
    if (settings.get('sensitivityMode') !== 'auto' || settings.get('calibrated')) return;
    const learned = calibrator.add(sample && sample.raw);
    if (!learned) return;
    updateSettings({ sensitivity: learned, calibrated: true });
    sendToMeter('meter:notice', 'Tuned to your voice');
}

function recalibrate() {
    calibrator.reset();
    updateSettings({ sensitivityMode: 'auto', calibrated: false, sensitivity: CONSTANTS.SENSITIVITY_PRESETS.MEDIUM });
    sendToMeter('meter:notice', 'Learning your voice…');
}

// Once a week, if you asked for it: a quiet note that last week is ready to
// look at. It never interrupts a call, and the first week only notes where
// we are. It carries no numbers, so it needs nothing but the history.
function checkWeeklyRecap() {
    if (!settings.get('weeklyRecap') || !settings.get('onboarded')) return;
    if (runtime.micApp) return; // On a call: try again at the next check
    const now = Date.now();
    // The seven days before today, so Monday's recap covers Monday to Sunday.
    const week = analytics.weekSummary(history.listDays(15), now - DAY_MS);
    const lastWeek = settings.get('lastRecapWeek');
    const due = recapDue({ now, lastWeek, monitoredSeconds: week.current ? week.current.seconds : 0 });
    if (due.week !== lastWeek) settings.update({ lastRecapWeek: due.week });
    if (!due.show) return;
    notify('Your week in volume is ready', 'See how last week sounded, and share it if you like.',
        () => openInsights({ share: true }));
}

function hourly() {
    history.prune(HISTORY_RETENTION_DAYS);
    checkWeeklyRecap();
}

async function calendarState() {
    if (!native.available) return { available: false, enabled: false, status: 'unavailable' };
    return { available: true, enabled: settings.get('calendar'), status: await native.calendarStatus() };
}

// Calendar events are read on demand and never written to disk.
let eventCache = null;
async function calendarEvents(state, from, to) {
    if (!state.enabled || state.status !== 'granted') return null;
    const key = `${from}-${to}`;
    if (!eventCache || eventCache.key !== key || Date.now() - eventCache.at > CALENDAR_CACHE_MS) {
        eventCache = { key, at: Date.now(), events: await native.calendarEvents(from, to) };
    }
    return eventCache.events;
}

const startOfDay = (ts) => new Date(ts).setHours(0, 0, 0, 0);

async function dayInsights(date) {
    const day = history.getDay(date);
    const from = new Date(`${date}T00:00:00`).getTime();
    const calendar = await calendarState();
    const events = await calendarEvents(calendar, from, from + DAY_MS);
    return {
        ...day,
        apps: analytics.byApp(day.minutes),
        calendar,
        meetings: events && analytics.meetingsForDay(day.minutes, events)
    };
}

async function trendInsights() {
    const now = Date.now();
    const minutes = history.getRange(TRENDS_DAYS, now);
    const calendar = await calendarState();
    const events = await calendarEvents(calendar, startOfDay(now) - (TRENDS_DAYS - 1) * DAY_MS, startOfDay(now) + DAY_MS);
    return {
        days: TRENDS_DAYS,
        hasData: minutes.length > 0,
        week: analytics.weekSummary(history.listDays(14), now),
        heatmap: analytics.heatmap(minutes),
        apps: analytics.byApp(minutes),
        calendar,
        meetings: events && analytics.meetingsByTitle(minutes, events),
        people: events && analytics.byPerson(minutes, events)
    };
}

// Opting in asks macOS for permission the first time; if it was refused
// earlier, the only way forward is System Settings.
async function connectCalendar() {
    let state = await calendarState();
    if (!state.available) return state;
    if (state.status === 'not-determined') await native.calendarRequest();
    updateSettings({ calendar: true });
    eventCache = null;
    state = await calendarState();
    if (state.status !== 'granted') shell.openExternal(CALENDAR_SETTINGS_URL);
    return state;
}

function disconnectCalendar() {
    updateSettings({ calendar: false });
    eventCache = null;
    return calendarState();
}

/* ---------------------------------------------------------------- windows */

// The saved position is where the orb's centre is, so it means the same
// thing whatever size the window around it happens to be.
const workAreas = () => screen.getAllDisplays().map((display) => display.workArea);
const orbDiameter = () => (CONSTANTS.ORB_DIAMETERS[settings.get('orbSize')] || CONSTANTS.ORB_DIAMETERS.medium)[0];
const windowAt = (centre) => ({ x: Math.round(centre.x - METER_SIZE / 2), y: Math.round(centre.y - METER_SIZE / 2) });

function resolveMeterPosition() {
    return windowAt(resolveCentre({
        saved: settings.get('position'),
        areas: workAreas(),
        primary: screen.getPrimaryDisplay().workArea,
        diameter: orbDiameter()
    }));
}

// Puts the orb back where it belongs: after a reset, a change of size, or a
// screen being unplugged or resized.
function placeMeter() {
    if (!meterWindow || dragOrigin) return;
    const { x, y } = resolveMeterPosition();
    meterWindow.setPosition(x, y);
    reportRoom();
}

// Tells the orb how close it is to the edges of its screen, so its labels
// can keep out of the way of them.
function reportRoom() {
    if (!meterWindow) return;
    const [x, y] = meterWindow.getPosition();
    const centre = { x: x + METER_SIZE / 2, y: y + METER_SIZE / 2 };
    sendToMeter('meter:moved', roomAround(centre, nearestArea(centre, workAreas())));
}

function createMeterWindow() {
    if (meterWindow) {
        hiddenWhileIdle = false;
        meterWindow.show();
        return meterWindow;
    }

    meterWindow = new BrowserWindow({
        width: METER_SIZE,
        height: METER_SIZE,
        ...resolveMeterPosition(),
        webPreferences: { ...webPreferences, backgroundThrottling: false },
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        hasShadow: false,
        skipTaskbar: true,
        show: false,
        type: 'panel', // Floats without stealing focus on macOS
        // The window is mostly empty room for the glow. Without this macOS
        // keeps all of it below the menu bar, and the orb out of the corners.
        enableLargerThanScreen: true
    });

    // Stay visible over full-screen apps (video calls, slides).
    meterWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    meterWindow.setAlwaysOnTop(true, 'floating');
    // Clicks pass through the transparent corners; the renderer turns this
    // off while the pointer is over the orb.
    meterWindow.setIgnoreMouseEvents(true, { forward: true });

    meterWindow.loadFile('src/index.html');
    meterWindow.webContents.on('did-finish-load', reportRoom);
    meterWindow.once('ready-to-show', () => {
        if (runtime.idle) hiddenWhileIdle = true;
        else meterWindow.showInactive();
        refreshTray();
    });
    meterWindow.on('show', refreshTray);
    meterWindow.on('hide', refreshTray);
    meterWindow.on('closed', () => {
        meterWindow = null;
        refreshTray();
    });

    return meterWindow;
}

function toggleMeter() {
    hiddenWhileIdle = false;
    if (!meterWindow) createMeterWindow();
    else if (meterWindow.isVisible()) meterWindow.hide();
    else meterWindow.showInactive();
}

// Standard (non-floating) windows share a look and manage the Dock icon:
// Sound Meter lives in the menu bar and only appears in the Dock while a
// real window is open.
function createPanelWindow(file, { query, ...options }) {
    const win = new BrowserWindow({
        show: false,
        titleBarStyle: 'hiddenInset',
        backgroundColor: nativeThemeBackground(),
        fullscreenable: false,
        webPreferences,
        ...options
    });
    win.loadFile(file, query ? { query } : undefined);
    win.once('ready-to-show', () => {
        win.show();
        syncDock();
    });
    win.on('closed', () => setImmediate(syncDock));
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https:\/\//.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    return win;
}

function nativeThemeBackground() {
    const { nativeTheme } = require('electron');
    return nativeTheme.shouldUseDarkColors ? '#0f1216' : '#f6f8fb';
}

function syncDock() {
    if (!app.dock) return;
    const hasPanel = [panelWindow, onboardingWindow].some((w) => w && !w.isDestroyed());
    if (hasPanel) app.dock.show();
    else app.dock.hide();
}

// 'insights' means Day, or Trends if that is what the window is already showing.
const PANEL_VIEWS = ['insights', 'day', 'trends', 'settings'];

/**
 * Opens the main window on a given view, or brings it forward and switches
 * to that view if it is already open. `share` also raises the share card.
 */
function openPanel(view = 'insights', { share = false } = {}) {
    if (!PANEL_VIEWS.includes(view)) view = 'insights';
    if (panelWindow) {
        panelWindow.show();
        panelWindow.focus();
        panelWindow.webContents.send('panel:show', { view, share });
        return;
    }
    panelWindow = createPanelWindow('src/panel.html', {
        width: 1140,
        height: 760,
        minWidth: 760,
        minHeight: 560,
        title: 'Sound Meter',
        query: share ? { view, share: '1' } : { view }
    });
    panelWindow.on('closed', () => {
        panelWindow = null;
    });
}

const openInsights = ({ share = false } = {}) => openPanel(share ? 'trends' : 'insights', { share });
const openSettings = () => openPanel('settings');

function resetMeterPosition() {
    updateSettings({ position: null });
    createMeterWindow();
    placeMeter();
}

// What the Settings panel can ask for beyond changing a setting.
const SETTINGS_ACTIONS = {
    'relearn': () => recalibrate(),
    'reset-position': () => resetMeterPosition(),
    'launch-at-login': (value) => setLaunchAtLogin(value === true),
    'check-updates': () => checkForUpdates(true),
    'restart-to-update': () => { if (autoUpdater && runtime.update.status === 'ready') autoUpdater.quitAndInstall(); },
    'open-audio-settings': () => shell.openExternal(SYSTEM_AUDIO_SETTINGS_URL),
    'retry-voice': () => {
        runtime.voiceRetry += 1;
        broadcastState();
    },
    'quit': () => app.quit()
};

function openOnboarding() {
    if (onboardingWindow) {
        onboardingWindow.focus();
        return;
    }
    onboardingWindow = createPanelWindow('src/onboarding.html', {
        width: 520,
        height: 680,
        resizable: false,
        maximizable: false,
        title: 'Welcome to Sound Meter'
    });
    onboardingWindow.on('closed', () => {
        onboardingWindow = null;
        // Closing the welcome window early still leaves you with a working app.
        if (!isQuitting) createMeterWindow();
    });
}

/* ------------------------------------------------------------------- menu */

function sendToMeter(channel, payload) {
    if (meterWindow && !meterWindow.isDestroyed()) meterWindow.webContents.send(channel, payload);
}

function statusLabel() {
    if (runtime.micStatus === 'denied') return 'Microphone access needed';
    if (runtime.micStatus === 'no-device') return 'No microphone found';
    if (settings.get('paused')) return 'Paused';
    if (runtime.idle) return 'Waiting for a call';
    const label = settings.get('deviceLabel');
    const where = runtime.micApp ? ` · on ${runtime.micApp}` : '';
    const learning = settings.get('sensitivityMode') === 'auto' && !settings.get('calibrated') ? ' · learning your voice' : '';
    return `${label ? `Listening · ${label}` : 'Listening'}${where}${learning}`;
}

const toggle = (label, key, extra = {}) => ({
    label,
    type: 'checkbox',
    checked: !!settings.get(key),
    click: (item) => updateSettings({ [key]: item.checked }),
    ...extra
});

const choice = (label, key, options) => ({
    label,
    submenu: options.map(([value, name]) => ({
        label: name,
        type: 'radio',
        checked: settings.get(key) === value,
        click: () => updateSettings({ [key]: value })
    }))
});

function sensitivityMenu() {
    const auto = settings.get('sensitivityMode') === 'auto';
    const sensitivity = settings.get('sensitivity');
    return {
        label: 'Sensitivity',
        submenu: [
            {
                label: !auto ? 'Automatic' : settings.get('calibrated') ? 'Automatic — tuned to your voice' : 'Automatic — learning your voice…',
                type: 'radio',
                checked: auto,
                click: () => { if (!auto) recalibrate(); }
            },
            ...CONSTANTS.SENSITIVITY_OPTIONS.map((option) => ({
                label: `${option.label} — ${option.hint}`,
                type: 'radio',
                checked: !auto && option.value === sensitivity,
                click: () => updateSettings({ sensitivityMode: 'manual', sensitivity: option.value })
            })),
            { type: 'separator' },
            { label: 'Relearn My Voice', enabled: auto, click: recalibrate }
        ]
    };
}

function buildMenuTemplate({ forTray = false } = {}) {
    const paused = settings.get('paused');
    const deviceId = settings.get('deviceId');
    const meterVisible = !!meterWindow && meterWindow.isVisible();
    // Until we've heard back, assume this Mac can detect calls.
    const callsSupported = runtime.micSupported || !runtime.micKnown;
    const template = [{ label: statusLabel(), enabled: false }];

    if (runtime.micStatus === 'denied') {
        template.push({
            label: 'Open Microphone Settings…',
            click: () => shell.openExternal(MIC_SETTINGS_URL)
        });
    }
    if (runtime.voice === 'fallback') {
        template.push(
            { label: 'Voice Focus needs permission to hear system audio', enabled: false },
            { label: 'Open System Audio Settings…', click: () => shell.openExternal(SYSTEM_AUDIO_SETTINGS_URL) }
        );
    }

    template.push(
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Command+,', click: openSettings },
        {
            label: paused ? 'Resume Listening' : 'Pause Listening',
            click: () => updateSettings({ paused: !paused })
        },
        toggle(callsSupported ? 'Listen Only During Calls' : 'Listen Only During Calls (needs macOS 14.2)', 'onlyDuringCalls', {
            visible: native.available,
            enabled: callsSupported,
            toolTip: 'Hide the orb and release the microphone unless another app is using it'
        }),
        {
            label: 'Microphone',
            enabled: runtime.devices.length > 0,
            submenu: runtime.devices.map((device, index) => ({
                label: device.label,
                type: 'radio',
                checked: deviceId ? device.id === deviceId : index === 0,
                click: () => updateSettings({ deviceId: device.id, deviceLabel: device.label })
            }))
        },
        sensitivityMenu(),
        toggle(VOICE_SUPPORTED ? 'Voice Focus' : 'Voice Focus (needs macOS 14.2)', 'voiceFocus', {
            toolTip: 'Ignore sound from your speakers',
            enabled: VOICE_SUPPORTED,
            checked: VOICE_SUPPORTED && !!settings.get('voiceFocus')
        }),
        { type: 'separator' },
        { label: 'Insights…', click: () => openInsights() },
        {
            label: 'Show Meetings from Calendar',
            type: 'checkbox',
            visible: native.available,
            checked: settings.get('calendar'),
            click: (item) => (item.checked ? connectCalendar() : disconnectCalendar())
        },
        {
            label: 'Notifications',
            submenu: [
                toggle('Nudge Me When I’m Loud for a While', 'nudge'),
                toggle('Tell Me When My Week Is Ready', 'weeklyRecap')
            ]
        },
        { type: 'separator' },
        {
            label: 'Orb',
            submenu: [
                choice('Size', 'orbSize', ORB_SIZES),
                choice('Opacity', 'orbOpacity', ORB_OPACITIES),
                toggle('Show Level Symbols', 'symbols', { toolTip: 'Arrows in the orb as it gets louder, for when colour alone is hard to read' }),
                { type: 'separator' },
                { label: 'Reset Position', click: resetMeterPosition }
            ]
        },
        {
            label: meterVisible ? 'Hide Meter' : 'Show Meter',
            visible: forTray || meterVisible,
            click: toggleMeter
        },
        { type: 'separator' },
        {
            label: 'Launch at Login',
            type: 'checkbox',
            checked: getLaunchAtLogin(),
            click: (item) => setLaunchAtLogin(item.checked)
        },
        updateMenuItem(),
        { label: `About Sound Meter ${app.getVersion()}`, click: () => shell.openExternal(WEBSITE_URL) },
        { type: 'separator' },
        { label: 'Quit Sound Meter', accelerator: 'Command+Q', click: () => app.quit() }
    );

    return template;
}

function createTray() {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    refreshTray();
}

function refreshTray() {
    if (!tray || tray.isDestroyed()) return;
    tray.setToolTip(`Sound Meter — ${statusLabel()}`);
    tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate({ forTray: true })));
}

// Minimal application menu so standard shortcuts (copy, close, quit) work
// in the Insights and welcome windows.
function createAppMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        { role: 'editMenu' },
        { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] }
    ]));
}

/* ---------------------------------------------------------------- updates */

let autoUpdater = null;
let manualUpdateCheck = false;

function setUpdate(status, version = runtime.update.version) {
    runtime.update = { status, version };
    broadcastState();
}

function updateMenuItem() {
    const { status, version } = runtime.update;
    if (status === 'ready') {
        return { label: `Restart to Update${version ? ` (${version})` : ''}`, click: () => autoUpdater.quitAndInstall() };
    }
    if (status === 'checking') return { label: 'Checking for Updates…', enabled: false };
    if (status === 'downloading') return { label: 'Downloading Update…', enabled: false };
    return {
        label: 'Check for Updates…',
        enabled: app.isPackaged,
        click: () => checkForUpdates(true)
    };
}

function initAutoUpdater() {
    if (!app.isPackaged) return;
    try {
        ({ autoUpdater } = require('electron-updater'));
        const log = require('electron-log');
        autoUpdater.logger = log;
        autoUpdater.logger.transports.file.level = 'info';

        autoUpdater.on('checking-for-update', () => setUpdate('checking'));
        autoUpdater.on('update-available', (info) => setUpdate('downloading', info.version));
        autoUpdater.on('update-downloaded', (info) => setUpdate('ready', info.version));
        autoUpdater.on('update-not-available', () => {
            setUpdate('idle', null);
            if (manualUpdateCheck) {
                dialog.showMessageBox({
                    type: 'info',
                    message: 'You’re up to date',
                    detail: `Sound Meter ${app.getVersion()} is the latest version.`
                });
            }
            manualUpdateCheck = false;
        });
        autoUpdater.on('error', (error) => {
            setUpdate('idle', null);
            if (manualUpdateCheck) {
                dialog.showMessageBox({
                    type: 'warning',
                    message: 'Couldn’t check for updates',
                    detail: describeUpdateError(error)
                });
            }
            manualUpdateCheck = false;
            console.error('Auto-update error:', error);
        });

        checkForUpdates(false);
        setInterval(() => checkForUpdates(false), 60 * 60 * 1000);
    } catch (error) {
        console.error('Failed to initialize auto-updater:', error);
    }
}

function checkForUpdates(manual) {
    if (!autoUpdater || runtime.update.status !== 'idle') return;
    manualUpdateCheck = manual;
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

/* -------------------------------------------------------------------- ipc */

function registerIpc() {
    ipcMain.handle('state:get', () => getState());
    ipcMain.handle('settings:update', (_event, patch) => {
        updateSettings(patch);
        return getState();
    });

    ipcMain.on('meter:devices', (_event, devices) => {
        runtime.devices = Array.isArray(devices)
            ? devices.filter((d) => d && typeof d.id === 'string').map((d) => ({ id: d.id, label: String(d.label || 'Microphone') }))
            : [];
        refreshTray();
    });

    ipcMain.on('meter:mic-status', (_event, status) => {
        if (runtime.micStatus === status) return;
        runtime.micStatus = status;
        pollMicApp();
        broadcastState();
    });

    ipcMain.on('meter:voice', (_event, voice) => {
        if (!['off', 'on', 'fallback'].includes(voice) || voice === runtime.voice) return;
        runtime.voice = voice;
        broadcastState();
    });

    ipcMain.on('meter:sample', (_event, sample) => {
        if (settings.get('paused') || runtime.idle) return;
        history.record(sample, Date.now(), { app: runtime.micApp });
        learnVoice(sample);
        if (settings.get('nudge') && sample && nudger.sample(sample.avg)) {
            notify('You’re getting loud', 'You’ve been above your limit for a little while.');
        }
        if (panelWindow && !panelWindow.isDestroyed()) {
            panelWindow.webContents.send('history:sample', sample);
        }
    });

    ipcMain.on('settings:open', openSettings);
    ipcMain.handle('settings:action', (_event, name, value) => {
        const action = Object.prototype.hasOwnProperty.call(SETTINGS_ACTIONS, name) ? SETTINGS_ACTIONS[name] : null;
        if (!action) return false;
        action(value);
        return true;
    });

    ipcMain.on('meter:menu', () => {
        if (!meterWindow) return;
        Menu.buildFromTemplate(buildMenuTemplate()).popup({ window: meterWindow });
    });

    ipcMain.on('meter:ignore-mouse', (_event, ignore) => {
        if (meterWindow) meterWindow.setIgnoreMouseEvents(!!ignore, { forward: true });
    });

    // A drag moves the orb's centre, which stops at the edges of the screen
    // it is on (or nearest to) so the orb can't be lost off the side.
    ipcMain.on('meter:drag-start', () => {
        if (!meterWindow) return;
        const [x, y] = meterWindow.getPosition();
        dragOrigin = { x: x + METER_SIZE / 2, y: y + METER_SIZE / 2 };
    });
    ipcMain.on('meter:drag-move', (_event, dx, dy) => {
        if (!meterWindow || !dragOrigin || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
        const wanted = { x: dragOrigin.x + dx, y: dragOrigin.y + dy };
        const { x, y } = windowAt(clampCentre(wanted, nearestArea(wanted, workAreas()), orbDiameter()));
        meterWindow.setPosition(x, y);
    });
    ipcMain.on('meter:drag-end', () => {
        if (!meterWindow || !dragOrigin) return;
        const [x, y] = meterWindow.getPosition();
        dragOrigin = null;
        settings.update({ position: { x: x + METER_SIZE / 2, y: y + METER_SIZE / 2 } });
        reportRoom();
    });

    ipcMain.handle('mic:status', () => systemPreferences.getMediaAccessStatus('microphone'));
    ipcMain.handle('mic:request', async () => {
        try {
            await systemPreferences.askForMediaAccess('microphone');
        } catch (error) {
            console.error('Microphone request failed:', error);
        }
        return systemPreferences.getMediaAccessStatus('microphone');
    });
    ipcMain.on('mic:open-settings', () => shell.openExternal(MIC_SETTINGS_URL));

    ipcMain.handle('install:move', () => moveToApplications(app));
    ipcMain.handle('install:stay', () => { settings.update({ declinedMove: true }); });
    // Someone already set up, who was only asked about moving.
    ipcMain.on('onboarding:close', () => { if (onboardingWindow) onboardingWindow.close(); });

    ipcMain.handle('onboarding:finish', (_event, options = {}) => {
        const patch = { onboarded: true, sensitivityMode: options.sensitivityMode === 'manual' ? 'manual' : 'auto', calibrated: false };
        if (patch.sensitivityMode === 'manual' && Number.isFinite(options.sensitivity)) patch.sensitivity = options.sensitivity;
        if (typeof options.weeklyRecap === 'boolean') patch.weeklyRecap = options.weeklyRecap;
        if (typeof options.voiceFocus === 'boolean') patch.voiceFocus = options.voiceFocus;
        updateSettings(patch);
        if (typeof options.launchAtLogin === 'boolean') setLaunchAtLogin(options.launchAtLogin);
        createMeterWindow();
        if (onboardingWindow) onboardingWindow.close();
    });

    ipcMain.on('insights:open', () => openInsights());
    ipcMain.handle('history:days', (_event, limit) => history.listDays(Number.isFinite(limit) ? limit : 14));
    ipcMain.handle('insights:day', (_event, date) =>
        /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? dayInsights(date) : null);
    ipcMain.handle('insights:trends', () => trendInsights());
    ipcMain.handle('calendar:connect', () => connectCalendar());
    ipcMain.handle('calendar:disconnect', () => disconnectCalendar());

    // Sharing. The dialog asks for a share to be prepared; every later
    // action uses that prepared share, so a window can only ever send out
    // the link and words built here.
    let share = null;
    const shareImage = (dataUrl) => {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 8e6) return null;
        const image = nativeImage.createFromDataURL(dataUrl);
        return image.isEmpty() ? null : image;
    };
    ipcMain.handle('share:prepare', async () => {
        share = prepareShare(await trendInsights());
        return share && { card: share.card, url: share.url, displayUrl: share.displayUrl, destinations: share.destinations };
    });
    ipcMain.handle('share:copy-link', () => {
        if (share) clipboard.writeText(share.url);
        return !!share;
    });
    ipcMain.handle('share:copy-image', (_event, dataUrl) => {
        const image = shareImage(dataUrl);
        if (image) clipboard.writeImage(image);
        return !!image;
    });
    ipcMain.handle('share:open', (_event, key) => {
        const url = share && destinationUrl(key, share.stats);
        if (url) shell.openExternal(url);
        return !!url;
    });
    ipcMain.handle('share:more', (_event, dataUrl) => {
        const image = shareImage(dataUrl);
        if (!share || !image || !panelWindow) return false;
        const file = path.join(app.getPath('temp'), 'My week on Shhh.it.png');
        fs.writeFileSync(file, image.toPNG());
        new ShareMenu({ texts: [share.caption], urls: [share.url], filePaths: [file] }).popup({ window: panelWindow });
        return true;
    });
    ipcMain.handle('share:save', async (_event, dataUrl) => {
        const image = shareImage(dataUrl);
        if (!image) return false;
        const { canceled, filePath } = await dialog.showSaveDialog(panelWindow, {
            title: 'Save your week',
            defaultPath: path.join(app.getPath('downloads'), 'My week on Shhh.it.png'),
            filters: [{ name: 'PNG image', extensions: ['png'] }]
        });
        if (canceled || !filePath) return false;
        fs.writeFileSync(filePath, image.toPNG());
        return true;
    });

    ipcMain.handle('history:export', async () => {
        const { canceled, filePath } = await dialog.showSaveDialog(panelWindow, {
            title: 'Export history',
            defaultPath: path.join(app.getPath('downloads'), 'sound-meter-history.csv'),
            filters: [{ name: 'CSV', extensions: ['csv'] }]
        });
        if (canceled || !filePath) return false;
        fs.writeFileSync(filePath, history.toCsv());
        shell.showItemInFolder(filePath);
        return true;
    });

    ipcMain.handle('history:clear', async () => {
        const { response } = await dialog.showMessageBox(panelWindow, {
            type: 'warning',
            buttons: ['Delete History', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            message: 'Delete all loudness history?',
            detail: 'This removes every day of history stored on this Mac. It can’t be undone.'
        });
        if (response !== 0) return false;
        history.clear();
        return true;
    });
}

/* -------------------------------------------------------------- lifecycle */

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (onboardingWindow) onboardingWindow.focus();
        else createMeterWindow();
    });

    app.whenReady().then(() => {
        history = createHistory(path.join(app.getPath('userData'), 'history'));
        history.prune(HISTORY_RETENTION_DAYS);
        native = createNative({
            helperPath: app.isPackaged
                ? path.join(process.resourcesPath, 'sm-helper')
                : path.join(__dirname, 'native', 'bin', 'sm-helper'),
            fixturesPath: process.env.SOUND_METER_FIXTURES || null,
            ownBundleIds: ['com.benjscohen.soundmeter', 'com.github.electron']
        });
        for (const change of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(change, placeMeter);
        setInterval(pollMicApp, MIC_APP_POLL_MS);
        pollMicApp();
        setTimeout(checkWeeklyRecap, 60 * 1000);
        setInterval(hourly, HOURLY_MS);
        powerMonitor.on('resume', checkWeeklyRecap); // e.g. opening the laptop on Monday morning

        registerIpc();
        createAppMenu();
        createTray();

        // The welcome window is for a first run, and for a copy started
        // from the installer or Downloads, which it offers to move.
        if (settings.get('onboarded') && !offerMove()) {
            syncDock();
            createMeterWindow();
        } else {
            openOnboarding();
        }

        // Keep startup snappy: look for updates once the UI is up.
        setTimeout(initAutoUpdater, 3000);

        app.on('activate', () => {
            if (onboardingWindow) onboardingWindow.focus();
            else if (!meterWindow || !meterWindow.isVisible()) toggleMeter();
        });
    });

    app.on('before-quit', () => {
        isQuitting = true;
        if (history) history.flush();
    });

    // Menu-bar app: keep running when windows close.
    app.on('window-all-closed', () => {});
}
