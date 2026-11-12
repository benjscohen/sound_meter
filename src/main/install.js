// Running Sound Meter from the installer window or the Downloads folder
// half-works: it can't update itself, and it vanishes when the disk image is
// ejected. So the first time it starts from anywhere but Applications, it
// offers to move itself there.

/**
 * @param {object} deps
 * @param {Electron.App} deps.app
 * @param {Electron.Dialog} deps.dialog
 * @param {{ get(key: string): any, update(patch: object): boolean }} deps.settings
 * @returns {Promise<boolean>} true if the app is moving (it relaunches from Applications, so stop starting up)
 */
async function offerMoveToApplications({ app, dialog, settings }) {
    if (!app.isPackaged || process.platform !== 'darwin') return false;
    if (app.isInApplicationsFolder() || settings.get('declinedMove')) return false;

    const { response } = await dialog.showMessageBox({
        type: 'question',
        message: 'Move Sound Meter to your Applications folder?',
        detail: 'It’s running from somewhere temporary. In Applications it can keep itself up to date and will be there next time you need it.',
        buttons: ['Move to Applications', 'Not Now'],
        defaultId: 0,
        cancelId: 1
    });
    if (response !== 0) {
        // Asked and answered: don't bring it up at every launch.
        settings.update({ declinedMove: true });
        return false;
    }

    try {
        // Copies the app across, opens that copy and quits this one.
        return app.moveToApplicationsFolder();
    } catch (error) {
        console.error('Could not move to Applications:', error);
        await dialog.showMessageBox({
            type: 'warning',
            message: 'Sound Meter couldn’t move itself',
            detail: 'Drag Sound Meter into your Applications folder, then open it from there.',
            buttons: ['OK']
        });
        return false;
    }
}

module.exports = { offerMoveToApplications };
