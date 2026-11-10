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

/** The installers in a release: one per chip when there are two, else just one. */
export function installers(assets) {
    const dmgs = (assets || []).filter((asset) => asset.name.endsWith('.dmg'));
    const find = (pattern) => dmgs.find((asset) => pattern.test(asset.name))?.browser_download_url || null;
    return { arm64: find(/arm64/), x64: find(/x64/), any: dmgs[0]?.browser_download_url || null };
}

/**
 * Which chip a Mac has, from what the browser will tell us: Chromium's
 * `architecture` hint if there is one, otherwise the graphics chip. When
 * neither says, assume Apple silicon: every Mac sold since late 2020.
 */
export function chipFromHints({ architecture, renderer } = {}) {
    if (architecture) return architecture === 'arm' ? 'arm64' : 'x64';
    if (renderer && /intel|amd|radeon|nvidia/i.test(renderer)) return 'x64';
    return 'arm64';
}

/** Unhides everything that the released `version` is new enough for. */
export function revealForVersion(version) {
    document.querySelectorAll('[data-min-version]').forEach((element) => {
        element.hidden = compareVersions(version, element.dataset.minVersion) < 0;
    });
}
