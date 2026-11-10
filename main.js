const {
    app, BrowserWindow, screen, Tray, Menu, nativeImage, ipcMain,
    systemPreferences, shell, dialog
} = require('electron');
const fs = require('fs');
const path = require('path');
const { createSettings } = require('./src/main/settings');
const { createHistory } = require('./src/main/history');
const { CONSTANTS } = require('./src/utils/audio-visualizer');

const METER_SIZE = 168;
const METER_MARGIN = 16;
const HISTORY_RETENTION_DAYS = 90;
const MIC_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
const WEBSITE_URL = 'https://shhh.it.com';

let settings;
let history;
let tray = null;
let meterWindow = null;
let insightsWindow = null;
let onboardingWindow = null;
let dragOrigin = null;
let isQuitting = false;

// State that isn't persisted but that windows and menus care about.
const runtime = {
    devices: [],            // [{ id, label }] reported by the meter window
    micStatus: 'unknown',   // 'unknown' | 'granted' | 'denied' | 'no-device'
    update: { status: 'idle', version: null } // idle | checking | downloading | ready
};

const webPreferences = {
    preload: path.join(__dirname, 'src', 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
};

/* ------------------------------------------------------------------ state */

function getState() {
    return {
        settings: settings.all(),
        devices: runtime.devices,
        micStatus: runtime.micStatus,
        update: runtime.update,
        version: app.getVersion(),
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
    if (settings.update(patch)) broadcastState();
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

/* ---------------------------------------------------------------- windows */

function defaultMeterPosition() {
    const { x, y, width } = screen.getPrimaryDisplay().workArea;
    return { x: x + width - METER_SIZE - METER_MARGIN, y: y + METER_MARGIN };
}

// Use the saved position only if it is still on a connected display.
function resolveMeterPosition() {
    const saved = settings.get('position');
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        const centre = { x: saved.x + METER_SIZE / 2, y: saved.y + METER_SIZE / 2 };
        const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
            centre.x >= a.x && centre.x <= a.x + a.width &&
            centre.y >= a.y && centre.y <= a.y + a.height);
        if (onScreen) return { x: Math.round(saved.x), y: Math.round(saved.y) };
    }
    return defaultMeterPosition();
}

function createMeterWindow() {
    if (meterWindow) {
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
        type: 'panel' // Floats without stealing focus on macOS
    });

    // Stay visible over full-screen apps (video calls, slides).
    meterWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    meterWindow.setAlwaysOnTop(true, 'floating');
    // Clicks pass through the transparent corners; the renderer turns this
    // off while the pointer is over the orb.
    meterWindow.setIgnoreMouseEvents(true, { forward: true });

    meterWindow.loadFile('src/index.html');
    meterWindow.once('ready-to-show', () => {
        meterWindow.showInactive();
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
    if (!meterWindow) createMeterWindow();
    else if (meterWindow.isVisible()) meterWindow.hide();
    else meterWindow.showInactive();
}

// Standard (non-floating) windows share a look and manage the Dock icon:
// Sound Meter lives in the menu bar and only appears in the Dock while a
// real window is open.
function createPanelWindow(file, options) {
    const win = new BrowserWindow({
        show: false,
        titleBarStyle: 'hiddenInset',
        backgroundColor: nativeThemeBackground(),
        fullscreenable: false,
        webPreferences,
        ...options
    });
    win.loadFile(file);
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
    const hasPanel = [insightsWindow, onboardingWindow].some((w) => w && !w.isDestroyed());
    if (hasPanel) app.dock.show();
    else app.dock.hide();
}

function openInsights() {
    if (insightsWindow) {
        insightsWindow.show();
        insightsWindow.focus();
        return;
    }
    insightsWindow = createPanelWindow('src/insights.html', {
        width: 980,
        height: 720,
        minWidth: 720,
        minHeight: 560,
        title: 'Sound Meter Insights'
    });
    insightsWindow.on('closed', () => {
        insightsWindow = null;
    });
}

function openOnboarding() {
    if (onboardingWindow) {
        onboardingWindow.focus();
        return;
    }
    onboardingWindow = createPanelWindow('src/onboarding.html', {
        width: 520,
        height: 640,
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
    const label = settings.get('deviceLabel');
    return label ? `Listening · ${label}` : 'Listening';
}

function buildMenuTemplate({ forTray = false } = {}) {
    const paused = settings.get('paused');
    const sensitivity = settings.get('sensitivity');
    const deviceId = settings.get('deviceId');
    const meterVisible = !!meterWindow && meterWindow.isVisible();
    const template = [{ label: statusLabel(), enabled: false }];

    if (runtime.micStatus === 'denied') {
        template.push({
            label: 'Open Microphone Settings…',
            click: () => shell.openExternal(MIC_SETTINGS_URL)
        });
    }

    template.push(
        { type: 'separator' },
        {
            label: paused ? 'Resume Listening' : 'Pause Listening',
            click: () => updateSettings({ paused: !paused })
        },
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
        {
            label: 'Sensitivity',
            submenu: CONSTANTS.SENSITIVITY_OPTIONS.map((option) => ({
                label: `${option.label} — ${option.hint}`,
                type: 'radio',
                checked: option.value === sensitivity,
                click: () => updateSettings({ sensitivity: option.value })
            }))
        },
        { type: 'separator' },
        { label: 'Insights…', click: openInsights },
        {
            label: meterVisible ? 'Hide Meter' : 'Show Meter',
            click: toggleMeter
        },
        {
            label: 'Reset Meter Position',
            visible: forTray,
            click: () => {
                updateSettings({ position: null });
                const win = createMeterWindow();
                const { x, y } = defaultMeterPosition();
                win.setPosition(x, y);
            }
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
                    detail: 'Please check your internet connection and try again.'
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
        broadcastState();
    });

    ipcMain.on('meter:sample', (_event, sample) => {
        if (settings.get('paused')) return;
        history.record(sample);
        if (insightsWindow && !insightsWindow.isDestroyed()) {
            insightsWindow.webContents.send('history:sample', sample);
        }
    });

    ipcMain.on('meter:menu', () => {
        if (!meterWindow) return;
        Menu.buildFromTemplate(buildMenuTemplate()).popup({ window: meterWindow });
    });

    ipcMain.on('meter:ignore-mouse', (_event, ignore) => {
        if (meterWindow) meterWindow.setIgnoreMouseEvents(!!ignore, { forward: true });
    });

    ipcMain.on('meter:drag-start', () => {
        if (meterWindow) dragOrigin = meterWindow.getPosition();
    });
    ipcMain.on('meter:drag-move', (_event, dx, dy) => {
        if (!meterWindow || !dragOrigin || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
        meterWindow.setPosition(Math.round(dragOrigin[0] + dx), Math.round(dragOrigin[1] + dy));
    });
    ipcMain.on('meter:drag-end', () => {
        if (!meterWindow || !dragOrigin) return;
        const [x, y] = meterWindow.getPosition();
        dragOrigin = null;
        settings.update({ position: { x, y } });
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

    ipcMain.handle('onboarding:finish', (_event, options = {}) => {
        const patch = { onboarded: true };
        if (Number.isFinite(options.sensitivity)) patch.sensitivity = options.sensitivity;
        updateSettings(patch);
        if (typeof options.launchAtLogin === 'boolean') setLaunchAtLogin(options.launchAtLogin);
        createMeterWindow();
        if (onboardingWindow) onboardingWindow.close();
    });

    ipcMain.on('insights:open', openInsights);
    ipcMain.handle('history:days', (_event, limit) => history.listDays(Number.isFinite(limit) ? limit : 14));
    ipcMain.handle('history:day', (_event, date) =>
        /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? history.getDay(date) : null);

    ipcMain.handle('history:export', async () => {
        const { canceled, filePath } = await dialog.showSaveDialog(insightsWindow, {
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
        const { response } = await dialog.showMessageBox(insightsWindow, {
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
        const userData = app.getPath('userData');
        settings = createSettings(path.join(userData, 'settings.json'));
        history = createHistory(path.join(userData, 'history'));
        history.prune(HISTORY_RETENTION_DAYS);

        registerIpc();
        createAppMenu();
        createTray();

        if (settings.get('onboarded')) {
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
