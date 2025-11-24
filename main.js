const { app, BrowserWindow, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let tray = null;

function initAutoUpdater() {
    try {
        const { autoUpdater } = require('electron-updater');
        const log = require("electron-log");

        // Configure autoUpdater
        autoUpdater.logger = log;
        autoUpdater.logger.transports.file.level = "info";

        // Check for updates immediately
        autoUpdater.checkForUpdatesAndNotify();

        // Check for updates every hour (60 * 60 * 1000 ms)
        setInterval(() => {
            autoUpdater.checkForUpdatesAndNotify();
        }, 60 * 60 * 1000);
    } catch (error) {
        console.error('Failed to initialize auto-updater:', error);
    }
}

function createTray() {
    const iconPath = path.join(__dirname, 'icon.png');
    const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

    tray = new Tray(trayIcon);
    tray.setToolTip('Sound Meter');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show Sound Meter',
            click: () => {
                const wins = BrowserWindow.getAllWindows();
                if (wins.length > 0) {
                    wins[0].show();
                    wins[0].focus();
                } else {
                    createWindow();
                }
            }
        },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
    ]);

    tray.setContextMenu(contextMenu);
}

function createWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    const mainWindow = new BrowserWindow({
        width: 150,
        height: 150,
        x: width - 170, // Position top-right by default
        y: 20,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // For simpler local access, can be tightened later
        },
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        hasShadow: false,
        skipTaskbar: true,
        type: 'panel', // Helps with floating behavior on macOS
    });

    // Critical for macOS to stay on top of full-screen apps
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setAlwaysOnTop(true, 'floating');

    mainWindow.loadFile('src/index.html');

    // mainWindow.webContents.openDevTools({ mode: 'detach' }); // For debugging

    // Defer heavy background tasks until after the window is shown
    mainWindow.once('ready-to-show', () => {
        // Initialize auto-updater with a slight delay to prioritize UI responsiveness
        setTimeout(() => {
            initAutoUpdater();
        }, 2000);
    });
}

app.whenReady().then(() => {
    createTray();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    // Do not quit when window is closed, keep tray active
    // if (process.platform !== 'darwin') {
    //     app.quit();
    // }
});
