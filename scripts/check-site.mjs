// Checks the website's logic without a browser:
//  - sharing: links built by the app (src/main/share.js) must be understood
//    by the site (landing_page/api), with identical wording, and the site
//    must render the page and the preview image for them
//  - downloads: the right installer is picked for each kind of Mac
//
//   node scripts/check-site.mjs [output.png]
//
// Needs landing_page dependencies installed (npm ci in landing_page).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// The preview image fetches its fonts from the site; serve them from disk here.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    const { origin, pathname } = new URL(typeof input === 'string' ? input : input.url);
    if (origin !== 'https://shhh.it.com' || !pathname.startsWith('/fonts/')) return realFetch(input, init);
    return new Response(readFileSync(new URL(`../landing_page/public${pathname}`, import.meta.url)));
};

const require = createRequire(import.meta.url);
const app = require('../src/main/share.js');
const site = await import('../landing_page/api/_stats.js');
const { default: sharePage } = await import('../landing_page/api/share.js');
const { default: ogImage } = await import('../landing_page/api/og.js');

const samples = [
    { calm: 93, loud: 4200, monitored: 61560, streak: 3, avg: 38, dow: 4, hour: 15 },
    { calm: 100, loud: 0, monitored: 600, streak: 0, avg: 12, dow: null, hour: null },
    { calm: 0, loud: 3600, monitored: 3600, streak: 1, avg: 150, dow: 6, hour: 0 },
    { calm: 71, loud: 9000, monitored: 31000, streak: 12, avg: 64, dow: 0, hour: 12 }
];

for (const stats of samples) {
    const url = new URL(app.shareUrl(stats));
    assert.equal(url.origin + url.pathname, 'https://shhh.it.com/s');

    // Same numbers, same canonical link, same words on both sides.
    const parsed = site.parseStats(url.searchParams);
    assert.deepEqual(parsed, stats);
    assert.equal(site.toQuery(parsed), app.shareQuery(stats));
    assert.deepEqual(site.describe(parsed), app.describe(stats));

    // The page: personalised preview tags and a way to get the app.
    const page = await sharePage(new Request(url));
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, new RegExp(`<meta property="og:title" content="${stats.calm}% calm this week">`));
    assert.ok(html.includes(`property="og:image" content="https://shhh.it.com/api/og?${app.shareQuery(stats).replace(/&/g, '&#38;')}"`));
    assert.match(html, /<a class="btn" href="\/">Get Sound Meter<\/a>/);
}

// Links that aren't well formed never render: they go to the home page.
for (const bad of ['', 'c=101&l=0&m=60', 'c=50&l=100&m=60', 'c=50&l=0&m=0', 'c=<script>&l=0&m=60', 'c=5e1&l=0&m=60', 'c=50&l=0']) {
    const response = await sharePage(new Request(`https://shhh.it.com/s?${bad}`));
    assert.equal(response.status, 302, `should redirect: ${bad}`);
    assert.equal(response.headers.get('location'), 'https://shhh.it.com/');
    assert.equal((await ogImage(new Request(`https://shhh.it.com/api/og?${bad}`))).status, 404);
}
// Extra parameters are ignored rather than echoed.
const noisy = await (await sharePage(new Request('https://shhh.it.com/s?c=90&l=60&m=600&x=<b>hi</b>'))).text();
assert.ok(!noisy.includes('<b>hi</b>'));

// The preview image really is a 1200x630 PNG.
const image = await ogImage(new Request(app.shareUrl(samples[0]).replace('/s?', '/api/og?')));
assert.equal(image.status, 200);
assert.equal(image.headers.get('content-type'), 'image/png');
const png = Buffer.from(await image.arrayBuffer());
assert.equal(png.subarray(1, 4).toString(), 'PNG');
assert.equal(png.readUInt32BE(16), 1200);
assert.equal(png.readUInt32BE(20), 630);
if (process.argv[2]) writeFileSync(process.argv[2], png);

// Downloads: one installer per chip, picked from what the browser reveals.
const { installers, chipFromHints, compareVersions } = await import('../landing_page/release.js');
const asset = (name) => ({ name, browser_download_url: `https://example.test/${name}` });
const split = installers([asset('latest-mac.yml'), asset('Sound-Meter-1.4.0-arm64.dmg'), asset('Sound-Meter-1.4.0-x64.dmg'),
    asset('Sound-Meter-1.4.0-arm64.zip'), asset('Sound-Meter-1.4.0-x64.zip')]);
assert.equal(split.arm64, 'https://example.test/Sound-Meter-1.4.0-arm64.dmg');
assert.equal(split.x64, 'https://example.test/Sound-Meter-1.4.0-x64.dmg');
// Older releases had a single universal installer.
assert.deepEqual(installers([asset('Sound-Meter-1.3.0.dmg'), asset('Sound-Meter-1.3.0.zip')]),
    { arm64: null, x64: null, any: 'https://example.test/Sound-Meter-1.3.0.dmg' });
assert.deepEqual(installers(undefined), { arm64: null, x64: null, any: null });

assert.equal(chipFromHints({ architecture: 'arm' }), 'arm64');                       // Chrome on Apple silicon
assert.equal(chipFromHints({ architecture: 'x86', renderer: 'Apple M2' }), 'x64');    // Chrome's own answer wins
assert.equal(chipFromHints({ renderer: 'ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 655)' }), 'x64');
assert.equal(chipFromHints({ renderer: 'AMD Radeon Pro 5500M OpenGL Engine' }), 'x64');
assert.equal(chipFromHints({ renderer: 'Apple M1 Pro' }), 'arm64');
assert.equal(chipFromHints({ renderer: 'Apple GPU' }), 'arm64');                      // Safari says only this
assert.equal(chipFromHints({}), 'arm64');
assert.equal(chipFromHints(), 'arm64');

assert.ok(compareVersions('1.4.0', '1.3.9') > 0);
assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
assert.equal(compareVersions('1.4', '1.4.0'), 0);

console.log(`Site check passed: downloads, ${samples.length} links, page and ${png.length}-byte preview image.`);
