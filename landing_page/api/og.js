// GET /api/og?c=93&l=4200&m=61560...  ->  1200x630 PNG of a shared week.
// This is the image link previews show on X, LinkedIn, Slack and iMessage.
import { ImageResponse } from '@vercel/og';
import { parseStats, describe, colour } from './_stats.js';

export const config = { runtime: 'edge' };

const WEIGHTS = [500, 700, 800];
const INK = '#0a2540';

// Inter is served by the site itself (public/fonts). Loaded once per
// instance; if it can't be fetched the card still renders in a default font.
let fontsPromise = null;
function loadFonts(origin) {
    fontsPromise ??= Promise.all(WEIGHTS.map(async (weight) => {
        const response = await fetch(`${origin}/fonts/inter-${weight}.woff`);
        if (!response.ok) throw new Error(`Font ${weight}: ${response.status}`);
        return { name: 'Inter', data: await response.arrayBuffer(), weight, style: 'normal' };
    })).catch(() => {
        fontsPromise = null;
        return undefined;
    });
    return fontsPromise;
}
const MUTED = '#5b6b7f';

// Satori takes React-style elements; this builds them without JSX.
const el = (style, ...children) => ({
    type: 'div',
    props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children }
});

function orb(size, rgb) {
    return el({
        width: size,
        height: size,
        borderRadius: size,
        backgroundImage: `radial-gradient(circle at 34% 28%, rgba(255,255,255,0.75) 0%, rgba(${rgb},0.92) 46%, rgba(${rgb},0.82) 100%)`,
        boxShadow: `0 0 ${Math.round(size * 0.5)}px rgba(${rgb},0.5)`
    });
}

function ring(size, rgb, opacity) {
    return el({
        position: 'absolute',
        left: 980 - size / 2,
        top: 290 - size / 2,
        width: size,
        height: size,
        borderRadius: size,
        border: `2px solid rgba(${rgb},${opacity})`
    });
}

export function card(stats) {
    const text = describe(stats);
    const rgb = colour(stats).join(',');
    const [number, word] = text.headline.split(' ');

    return el(
        {
            position: 'relative',
            width: 1200,
            height: 630,
            flexDirection: 'column',
            padding: '64px 84px',
            color: INK,
            fontFamily: 'Inter',
            fontWeight: 500,
            backgroundColor: '#f8fafc',
            backgroundImage: `radial-gradient(circle at 82% 46%, rgba(${rgb},0.30) 0%, rgba(248,250,252,0) 46%)`
        },
        ring(300, rgb, 0.3),
        ring(420, rgb, 0.21),
        ring(540, rgb, 0.12),
        el({ position: 'absolute', left: 888, top: 198 }, orb(184, rgb)),

        el({ alignItems: 'center', fontSize: 30, fontWeight: 700 },
            orb(30, '48,209,88'),
            el({ marginLeft: 14 }, 'Shhh.it')),
        el({ marginTop: 56, fontSize: 30, fontWeight: 600, color: MUTED }, 'My week in volume'),
        el({ alignItems: 'flex-end', marginTop: 2 },
            el({ fontSize: 150, lineHeight: 1, fontWeight: 800, letterSpacing: -6 }, number),
            el({ marginLeft: 22, marginBottom: 17, fontSize: 64, lineHeight: 1, fontWeight: 700, letterSpacing: -2 }, word)),
        el({ marginTop: 18, fontSize: 30, color: MUTED }, text.line),
        el({ marginTop: 44 },
            ...text.stats.map(([label, value]) =>
                el({ flexDirection: 'column', marginRight: 56 },
                    el({ fontSize: 22, color: MUTED }, label),
                    el({ marginTop: 6, fontSize: 36, fontWeight: 700 }, value)))),
        el({ position: 'absolute', left: 84, bottom: 46, fontSize: 22, color: MUTED },
            'Know when you’re getting loud  ·  shhh.it.com')
    );
}

export default async function handler(request) {
    const url = new URL(request.url);
    const stats = parseStats(url.searchParams);
    if (!stats) return new Response('Not found', { status: 404 });
    return new ImageResponse(card(stats), {
        width: 1200,
        height: 630,
        fonts: await loadFonts(url.origin),
        headers: { 'cache-control': 'public, max-age=31536000, immutable' }
    });
}
