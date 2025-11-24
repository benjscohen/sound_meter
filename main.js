const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

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
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
