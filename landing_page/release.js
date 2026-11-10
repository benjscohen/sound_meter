// Shared by every page: which version is out, and showing content that
// only applies from a given version onward (data-min-version="1.4.0").
export const REPO = 'benjscohen/sound_meter';

export function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
}

/** Unhides everything that the released `version` is new enough for. */
export function revealForVersion(version) {
    document.querySelectorAll('[data-min-version]').forEach((element) => {
        element.hidden = compareVersions(version, element.dataset.minVersion) < 0;
    });
}
