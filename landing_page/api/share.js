// GET /s?c=93&l=4200&m=61560...  ->  the page a share link opens.
// It shows the sender's week and, quietly, where to get Sound Meter.
import { parseStats, toQuery, describe } from './_stats.js';

export const config = { runtime: 'edge' };

const escape = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function page(stats, origin) {
    const text = describe(stats);
    const query = toQuery(stats);
    const image = `${origin}/api/og?${query}`;
    const title = `${text.headline} this week`;
    const description = `${text.line}. Tracked with Sound Meter, a tiny orb for your Mac that shows when you’re getting loud.`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Shhh.it</title>
<meta name="description" content="${escape(description)}">
<meta name="robots" content="noindex">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Shhh.it">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${escape(`${origin}/s?${query}`)}">
<meta property="og:image" content="${escape(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(title)}">
<meta name="twitter:description" content="${escape(description)}">
<meta name="twitter:image" content="${escape(image)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{color-scheme:light dark;--bg:#f8fafc;--surface:#fff;--ink:#0a2540;--ink-2:#425466;--ink-3:#7a8799;--line:#e3e8ee;
--shadow:0 2px 6px rgba(10,37,64,.05),0 40px 80px -30px rgba(10,37,64,.32)}
@media (prefers-color-scheme:dark){:root{--bg:#0b0e12;--surface:#151a20;--ink:#f3f6fa;--ink-2:#b3bdc9;--ink-3:#77828f;--line:#252c35;
--shadow:0 2px 6px rgba(0,0,0,.4),0 40px 80px -30px rgba(0,0,0,.9)}}
*{box-sizing:border-box;margin:0}
body{min-height:100vh;display:flex;flex-direction:column;font:16px/1.6 Inter,system-ui,-apple-system,sans-serif;color:var(--ink);
background:radial-gradient(60% 50% at 50% 0%,rgba(48,209,88,.16),transparent 70%),var(--bg);-webkit-font-smoothing:antialiased}
a{color:inherit}
header,main,footer{width:100%;max-width:760px;margin:0 auto;padding:0 24px}
header{display:flex;align-items:center;height:68px}
.logo{display:inline-flex;align-items:center;gap:10px;font-weight:700;font-size:17px;letter-spacing:-.015em;text-decoration:none}
.dot{width:18px;height:18px;border-radius:50%;background:radial-gradient(circle at 32% 28%,rgba(255,255,255,.6),transparent 46%),#30d158;
box-shadow:0 0 10px rgba(48,209,88,.6)}
main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-top:24px;padding-bottom:56px;text-align:center}
.card{display:block;width:100%;height:auto;aspect-ratio:1200/630;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:var(--shadow)}
h1{margin-top:44px;font-size:clamp(28px,5vw,40px);line-height:1.12;font-weight:750;letter-spacing:-.035em;text-wrap:balance}
p{max-width:520px;margin-top:14px;color:var(--ink-2);font-size:17px}
.cta{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px 18px;margin-top:30px}
.btn{display:inline-flex;align-items:center;height:50px;padding:0 26px;border-radius:999px;background:var(--ink);color:var(--bg);
font-weight:600;text-decoration:none;transition:transform .2s cubic-bezier(.2,.8,.2,1)}
.btn:hover{transform:translateY(-2px)}
.more{color:var(--ink-2);font-weight:600;text-decoration:none}
.more:hover{color:var(--ink)}
.fine{margin-top:16px;color:var(--ink-3);font-size:13.5px}
footer{padding-top:22px;padding-bottom:26px;border-top:1px solid var(--line);color:var(--ink-3);font-size:13.5px;text-align:center}
</style>
</head>
<body>
<header><a class="logo" href="/"><span class="dot"></span>Shhh.it</a></header>
<main>
<img class="card" src="/api/og?${escape(query)}" width="1200" height="630" alt="${escape(`${text.headline}. ${text.line}.`)}">
<h1>Someone shared their week in volume.</h1>
<p>Sound Meter is a tiny orb that floats above your work on a Mac. It stays green while you speak comfortably and warms to red when you get loud.</p>
<div class="cta">
<a class="btn" href="/">Get Sound Meter</a>
<a class="more" href="/#how">See how it works →</a>
</div>
<p class="fine">Free and open source. Nothing is recorded, and this page stores nothing: the numbers live in the link.</p>
</main>
<footer>&copy; Benj Cohen · <a href="/">shhh.it.com</a></footer>
</body>
</html>`;
}

export default function handler(request) {
    const url = new URL(request.url);
    const stats = parseStats(url.searchParams);
    if (!stats) return Response.redirect(`${url.origin}/`, 302);
    return new Response(page(stats, url.origin), {
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'public, max-age=3600'
        }
    });
}
