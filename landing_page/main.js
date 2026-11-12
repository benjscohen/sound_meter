import { inject } from '@vercel/analytics';
import { REPO, chipFromHints, installers } from './release.js';

inject();

const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const CACHE_KEY = 'shhh-release-v2';
const CACHE_MS = 10 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

document.documentElement.classList.add('js');
$('year').textContent = new Date().getFullYear();

/* ------------------------------------------------------------------ orb */

// Same maths as the app (src/utils/audio-visualizer.js).
const YELLOW_POINT = 60 / 140;
const LOUD_POINT = 0.75;
const SENSITIVITY = 140;
const GREEN = [48, 209, 88];
const AMBER = [255, 204, 0];
const RED = [255, 69, 58];
const ZONES = { good: 'Sounding good', elevated: 'Getting loud', loud: 'Too loud' };

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const colorFor = (ratio) => ratio < YELLOW_POINT
    ? mix(GREEN, AMBER, ratio / YELLOW_POINT)
    : mix(AMBER, RED, (ratio - YELLOW_POINT) / (1 - YELLOW_POINT));
const zoneFor = (ratio) => (ratio >= LOUD_POINT ? 'loud' : ratio >= YELLOW_POINT ? 'elevated' : 'good');

const demo = $('demo');
const orb = $('demo-orb');
const tile = $('tile-you');
const status = $('demo-status');
const statusText = status.querySelector('span');
const toggle = $('demo-toggle');
const toggleText = toggle.querySelector('span');
const note = $('demo-note');
const NOTE_DEFAULT = note.textContent;

let analyser = null;
let stream = null;
let audioContext = null;
let data = null;
let level = 0;
let shownZone = null;
let visible = true;

// Until someone turns on their mic, the orb tells its own short story, slowly
// enough to follow: talking comfortably, getting carried away, noticing, and
// settling back down. [seconds, level], eased from one point to the next.
const STORY = [[0, 30], [5, 42], [8.5, 84], [11, 122], [12.5, 118], [16, 40], [18.5, 26], [20, 30]];
const STORY_SECONDS = STORY[STORY.length - 1][0];

function simulated(now) {
    const t = (now / 1000) % STORY_SECONDS;
    const next = STORY.findIndex(([at]) => at > t);
    const [t0, v0] = STORY[next - 1];
    const [t1, v1] = STORY[next];
    const eased = 0.5 - 0.5 * Math.cos(Math.PI * (t - t0) / (t1 - t0));
    // A slow rise and fall on top, like the swell of a sentence.
    const breath = 1 + 0.1 * Math.sin(now / 1400) + 0.05 * Math.sin(now / 610);
    return (v0 + (v1 - v0) * eased) * breath;
}

function measure(now) {
    if (!analyser) return simulated(now);
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return sum / data.length;
}

// How quickly the orb follows the level, as time constants in milliseconds.
// It rises faster than it falls, like the app, but never twitches.
const FOLLOW = { live: { up: 110, down: 420 }, story: { up: 380, down: 380 } };
let lastFrame = 0;

function frame(now) {
    requestAnimationFrame(frame);
    const elapsed = Math.min(now - lastFrame, 100);
    lastFrame = now;
    if (!visible) return;

    const raw = measure(now);
    const follow = analyser ? FOLLOW.live : FOLLOW.story;
    level += (raw - level) * (1 - Math.exp(-elapsed / (raw > level ? follow.up : follow.down)));
    const ratio = Math.min(level / SENSITIVITY, 1);
    const colour = colorFor(ratio).join(' ');

    orb.style.setProperty('--s', (1 + ratio * 1.3).toFixed(3));
    orb.style.setProperty('--c', colour);
    tile.style.setProperty('--c', colour);
    tile.style.setProperty('--ring', ratio > 0.06 ? '1' : '0');
    status.style.setProperty('--c', colour);

    const zone = zoneFor(ratio);
    if (zone !== shownZone) {
        shownZone = zone;
        statusText.textContent = ZONES[zone];
    }
}

function stopMic() {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    if (audioContext) audioContext.close().catch(() => {});
    stream = null;
    analyser = null;
    audioContext = null;
    demo.classList.remove('live');
    toggle.setAttribute('aria-pressed', 'false');
    toggleText.textContent = 'Try it with your voice';
}

async function startMic() {
    if (!navigator.mediaDevices?.getUserMedia) {
        note.textContent = 'Your browser doesn’t support microphone access here.';
        note.classList.add('error');
        return;
    }
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        audioContext.createMediaStreamSource(stream).connect(analyser);
        data = new Uint8Array(analyser.frequencyBinCount);
        demo.classList.add('live');
        toggle.setAttribute('aria-pressed', 'true');
        toggleText.textContent = 'Stop listening';
        note.textContent = 'Live. Say something — then say it louder.';
        note.classList.remove('error');
    } catch {
        stopMic();
        note.textContent = 'Microphone access was blocked. Allow it in your browser to try the live demo.';
        note.classList.add('error');
    }
}

toggle.addEventListener('click', () => {
    if (stream) {
        stopMic();
        note.textContent = NOTE_DEFAULT;
        note.classList.remove('error');
    } else {
        startMic();
    }
});

new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(demo);

if (reducedMotion) {
    orb.style.setProperty('--s', '1.25');
} else {
    requestAnimationFrame(frame);
}

/* ----------------------------------------------------------- page polish */

const nav = $('nav');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 12);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Fade sections in as they scroll into view.
const revealTargets = document.querySelectorAll(
    '.section-head, .why-inner, .zone, .feature, .trust-card, .step, .split-copy, .insights-card, .share-shot, .faq, .closing-inner');
const revealer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        revealer.unobserve(entry.target);
    }
}, { rootMargin: '0px 0px -8% 0px' });
revealTargets.forEach((el) => {
    const siblings = [...el.parentElement.children].filter((c) => c.className === el.className);
    el.style.setProperty('--delay', `${Math.min(siblings.indexOf(el), 5) * 70}ms`);
    el.classList.add('reveal');
    revealer.observe(el);
});

let toastTimer;
function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* -------------------------------------------------------------- download */

const isMac = /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || '')
    && !('ontouchend' in document && navigator.maxTouchPoints > 1); // iPadOS reports as Mac
if (!isMac) $('other-device').hidden = false;

$('copy-link').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText('https://shhh.it.com');
        toast('Link copied');
    } catch {
        toast('shhh.it.com');
    }
});

// After a download starts, walk people to "what next" instead of leaving
// them staring at the same page.
document.querySelectorAll('[data-download]').forEach((link) => {
    link.addEventListener('click', () => {
        if (!link.dataset.direct) return; // Still pointing at the GitHub page
        setTimeout(() => {
            $('download-banner').hidden = false;
            $('quick-steps').classList.add('next-up');
            $('install').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
        }, 500);
    });
});

// Macs come with either Apple silicon or an Intel chip, and each has its own
// (smaller) download. Gather what the browser will say and let
// chipFromHints decide.
async function detectChip() {
    const hints = {};
    try {
        hints.architecture = (await navigator.userAgentData.getHighEntropyValues(['architecture'])).architecture;
    } catch {
        // Not Chromium.
    }
    try {
        const gl = document.createElement('canvas').getContext('webgl');
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        hints.renderer = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    } catch {
        // No WebGL.
    }
    return chipFromHints(hints);
}

const CHIPS = { arm64: 'Apple silicon', x64: 'Intel' };

async function chooseDownload(urls) {
    if (!urls.arm64 || !urls.x64) return urls.any;
    let chip = await detectChip();
    const show = () => {
        const other = chip === 'arm64' ? 'x64' : 'arm64';
        document.querySelectorAll('[data-download]').forEach((link) => { link.href = urls[chip]; });
        // Say which build this is, right beside every download button, with a
        // one-click way to get the other.
        document.querySelectorAll('.chip-line').forEach((line) => {
            line.querySelector('.chip-name').textContent = `For ${CHIPS[chip]} Macs.`;
            line.querySelector('.chip-switch').textContent = `Have an ${CHIPS[other]} Mac? Switch`;
            line.hidden = !isMac;
        });
    };
    document.querySelectorAll('.chip-switch').forEach((link) => link.addEventListener('click', (event) => {
        event.preventDefault();
        chip = chip === 'arm64' ? 'x64' : 'arm64';
        show();
    }));
    show();
    return urls[chip];
}

async function applyRelease({ version, urls, downloads }) {
    const url = urls && await chooseDownload(urls);
    if (url) {
        document.querySelectorAll('[data-download]').forEach((link) => {
            link.href = url;
            link.dataset.direct = 'true';
        });
    }
    if (version) {
        $('version-text').textContent = ` · Version ${version}`;
    }
    if (downloads >= 1000) {
        const count = $('download-count');
        count.textContent = `${downloads.toLocaleString()} downloads`;
        count.hidden = false;
    }
}

async function fetchRelease() {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
        headers: { Accept: 'application/vnd.github+json' }
    });
    if (!response.ok) throw new Error(`GitHub responded ${response.status}`);
    const releases = (await response.json()).filter((r) => !r.draft && !r.prerelease);
    const latest = releases[0];

    // Count people, not auto-update pings: only the installer and app archive.
    const downloads = releases
        .flatMap((release) => release.assets)
        .filter((asset) => /\.(dmg|zip)$/.test(asset.name))
        .reduce((total, asset) => total + asset.download_count, 0);

    return {
        version: latest ? latest.tag_name.replace(/^v/, '') : null,
        urls: installers(latest?.assets),
        downloads
    };
}

async function loadRelease() {
    try {
        const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
        if (cached && Date.now() - cached.at < CACHE_MS) {
            await applyRelease(cached.release);
            return;
        }
    } catch {
        // Ignore unreadable cache.
    }

    try {
        const release = await fetchRelease();
        await applyRelease(release);
        try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), release }));
        } catch {
            // Storage may be unavailable (private mode).
        }
    } catch (error) {
        // Buttons already point at the GitHub releases page, which always works.
        console.warn('Could not load release info:', error);
        document.querySelectorAll('[data-download]').forEach((link) => { link.href = RELEASES_URL; });
    }
}

loadRelease();
