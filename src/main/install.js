// Running Sound Meter from the installer window or the Downloads folder
// half-works: it can't update itself, and it vanishes when the disk image is
// ejected. So when it starts from anywhere but Applications, the welcome
// window first offers to move it there.

/** Whether to bring up the offer: a released build, somewhere else, not already turned down. */
function shouldOfferMove({ platform = process.platform, packaged, inApplications, declined }) {
    return platform === 'darwin' && !!packaged && !inApplications && !declined;
}

/**
 * Moves the app into Applications. When it works the copy there opens and
 * this one quits, so nothing after it matters; `moved: false` means we are
 * still here (it failed, or there was already a copy the user kept).
 */
function moveToApplications(app) {
    try {
        return { moved: !!app.moveToApplicationsFolder() };
    } catch (error) {
        console.error('Could not move to Applications:', error);
        return { moved: false };
    }
}

module.exports = { shouldOfferMove, moveToApplications };
