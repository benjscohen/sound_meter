// What the site needs to know about a release: where it lives and which
// installer suits which Mac.
export const REPO = 'benjscohen/sound_meter';

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
