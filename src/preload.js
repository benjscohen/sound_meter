// Bridge between the sandboxed windows and the main process. Renderers get
// this narrow API and nothing else - no Node, no direct IPC.
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('soundMeter', {
    // Shared state: settings, mic status, version, update status.
    getState: () => ipcRenderer.invoke('state:get'),
    onState: (callback) => subscribe('state:changed', callback),
    updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
    openSettings: () => ipcRenderer.send('settings:open'),
    settingsAction: (name, value) => ipcRenderer.invoke('settings:action', name, value),

    // Floating meter.
    reportDevices: (devices) => ipcRenderer.send('meter:devices', devices),
    reportMicStatus: (status) => ipcRenderer.send('meter:mic-status', status),
    sendSample: (sample) => ipcRenderer.send('meter:sample', sample),
    reportVoice: (voice) => ipcRenderer.send('meter:voice', voice),
    onNotice: (callback) => subscribe('meter:notice', callback),
    openMenu: () => ipcRenderer.send('meter:menu'),
    setIgnoreMouse: (ignore) => ipcRenderer.send('meter:ignore-mouse', ignore),
    dragStart: () => ipcRenderer.send('meter:drag-start'),
    dragMove: (dx, dy) => ipcRenderer.send('meter:drag-move', dx, dy),
    dragEnd: () => ipcRenderer.send('meter:drag-end'),

    // Microphone permission.
    micAccess: () => ipcRenderer.invoke('mic:status'),
    requestMicAccess: () => ipcRenderer.invoke('mic:request'),
    openMicSettings: () => ipcRenderer.send('mic:open-settings'),

    // Onboarding.
    finishOnboarding: (options) => ipcRenderer.invoke('onboarding:finish', options),
    closeOnboarding: () => ipcRenderer.send('onboarding:close'),
    moveToApplications: () => ipcRenderer.invoke('install:move'),
    stayPut: () => ipcRenderer.invoke('install:stay'),

    // Insights.
    openInsights: () => ipcRenderer.send('insights:open'),
    listDays: (limit) => ipcRenderer.invoke('history:days', limit),
    getDay: (date) => ipcRenderer.invoke('insights:day', date),
    getTrends: () => ipcRenderer.invoke('insights:trends'),
    connectCalendar: () => ipcRenderer.invoke('calendar:connect'),
    disconnectCalendar: () => ipcRenderer.invoke('calendar:disconnect'),
    share: {
        prepare: () => ipcRenderer.invoke('share:prepare'),
        copyLink: () => ipcRenderer.invoke('share:copy-link'),
        copyImage: (dataUrl) => ipcRenderer.invoke('share:copy-image', dataUrl),
        saveImage: (dataUrl) => ipcRenderer.invoke('share:save', dataUrl),
        open: (destination) => ipcRenderer.invoke('share:open', destination),
        more: (dataUrl) => ipcRenderer.invoke('share:more', dataUrl)
    },
    exportHistory: () => ipcRenderer.invoke('history:export'),
    clearHistory: () => ipcRenderer.invoke('history:clear'),
    onSample: (callback) => subscribe('history:sample', callback),
    onShow: (callback) => subscribe('panel:show', callback)
});
