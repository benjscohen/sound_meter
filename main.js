const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// Configure autoUpdater
autoUpdater.logger = require("electron-log");
autoUpdater.logger.transports.file.level = "info";

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
        skipTaskbar: true, // Optional: keeps it out of the dock/taskbar if desired, but maybe keep it for now
    });

    mainWindow.loadFile('src/index.html');

    // mainWindow.webContents.openDevTools({ mode: 'detach' }); // For debugging
}

app.whenReady().then(() => {
    createWindow();

    // Check for updates immediately
    autoUpdater.checkForUpdatesAndNotify();

    // Check for updates every hour (60 * 60 * 1000 ms)
    setInterval(() => {
        autoUpdater.checkForUpdatesAndNotify();
    }, 60 * 60 * 1000);

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
