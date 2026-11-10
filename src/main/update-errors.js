/**
 * Turns an auto-update failure into words for a person. The updater's own
 * errors are long and technical, and most failures are not the user's
 * internet connection, so we shouldn't say they are.
 */
function describeUpdateError(error) {
    const text = String((error && (error.message || error)) || '');

    // The release exists but its files aren't all there (yet).
    if (/latest-mac\.yml|HttpError: 404|status maybe not reported, but 404/i.test(text)) {
        return 'A new version is being published right now. Try again in a few minutes.';
    }
    if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION|ERR_TIMED_OUT|ENOTFOUND|ETIMEDOUT|ECONNRE/i.test(text)) {
        return 'Sound Meter couldn’t reach the update server. Check your internet connection and try again.';
    }
    if (/HttpError: (403|429)|rate limit/i.test(text)) {
        return 'The update server is busy. Try again in a little while.';
    }
    return 'Something went wrong while checking. Try again in a little while.';
}

module.exports = { describeUpdateError };
