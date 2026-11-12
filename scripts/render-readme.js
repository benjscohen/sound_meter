// Renders the pictures in the README (docs/readme/*.png), each in a light
// and a dark version so the page looks right in either GitHub theme.
//
// The app screenshots come from the end-to-end test, so run that first in
// both themes, then this:
//
//   npm run smoke && SMOKE_THEME=dark npm run smoke
//   npm run readme:images            (reads ./shots; SHOTS=dir to look elsewhere)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const shots = path.resolve(process.env.SHOTS || path.join(root, 'shots'));
const shot = (theme, name) => pathToFileURL(path.join(shots, `${theme}-${name}.png`)).href;

const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif`;
const THEMES = {
    light: {
        bg: '#f8fafc', surface: '#ffffff', ink: '#0a2540', ink2: '#4b5d73', ink3: '#7b8798', line: 'rgba(10,37,64,.10)',
        glow: [0.24, 0.18], shadow: 'rgba(10,37,64,.22)', bar: '#eef1f5'
    },
    dark: {
        bg: '#0b0e12', surface: '#151a20', ink: '#f3f6fa', ink2: '#b3bdc9', ink3: '#7d8895', line: 'rgba(255,255,255,.10)',
        glow: [0.20, 0.10], shadow: 'rgba(0,0,0,.6)', bar: '#1c2129'
    }
};
const COLOURS = { green: '48,209,88', amber: '255,204,0', red: '255,69,58' };

const orb = (size, colour) => `
    width:${size}px;height:${size}px;border-radius:50%;flex:none;
    background:
        radial-gradient(circle at 32% 28%, rgba(255,255,255,.6), rgba(255,255,255,0) 46%),
        radial-gradient(circle at 50% 55%, rgba(${COLOURS[colour]},.96), rgba(${COLOURS[colour]},.74));
    box-shadow: 0 0 ${Math.round(size * 0.42)}px rgba(${COLOURS[colour]},.5),
        inset 0 -${Math.round(size * 0.1)}px ${Math.round(size * 0.2)}px rgba(0,0,0,.12), inset 0 0 0 1px rgba(255,255,255,.28);`;

// Every picture is a rounded card on a transparent page, so it sits well on
// whatever GitHub puts behind it.
const page = (t, width, height, body, css = '') => `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0}
    html,body{width:${width}px;height:${height}px;overflow:hidden;background:transparent;font-family:${FONT};
        -webkit-font-smoothing:antialiased;color:${t.ink}}
    .card{position:relative;width:100%;height:100%;overflow:hidden;border-radius:28px;border:1px solid ${t.line};
        background:
            radial-gradient(48% 70% at 12% 0%, rgba(${COLOURS.green},${t.glow[0]}), transparent 70%),
            radial-gradient(42% 60% at 100% 100%, rgba(${COLOURS.amber},${t.glow[1]}), transparent 70%),
            ${t.bg}}
    ${css}</style><div class="card">${body}</div>`;

// A Mac window around a screenshot.
const frame = (t, src, width) => `
    <figure class="window" style="width:${width}px">
        <div class="bar"><i></i><i></i><i></i></div>
        <img src="${src}" style="width:100%;display:block">
    </figure>`;
const frameCss = (t) => `
    .window{overflow:hidden;border-radius:14px;border:1px solid ${t.line};background:${t.surface};
        box-shadow:0 30px 70px -24px ${t.shadow}, 0 2px 6px ${t.shadow.replace(/[\d.]+\)$/, '.08)')}}
    .bar{display:flex;gap:7px;align-items:center;height:30px;padding:0 13px;background:${t.bar};border-bottom:1px solid ${t.line}}
    .bar i{width:11px;height:11px;border-radius:50%;background:${t.ink3};opacity:.35}`;

const hero = (t) => page(t, 1200, 480, `
    <div class="copy">
        <div class="brand"><i></i>Sound Meter</div>
        <h1>Know when you’re<br>getting loud.</h1>
        <p>A small orb that floats over your calls.<br>Green when you’re comfortable, red when you’re too loud.</p>
    </div>
    <div class="states">
        <div><span><i class="good"></i></span><b>Sounding good</b></div>
        <div><span><i class="elevated"></i></span><b>Getting loud</b></div>
        <div><span><i class="loud"></i></span><b>Too loud</b></div>
    </div>`, `
    .card{display:flex;align-items:center;justify-content:space-between;padding:0 72px 0 76px}
    .brand{display:flex;align-items:center;gap:12px;font-size:21px;font-weight:650;letter-spacing:-.01em}
    .brand i{${orb(22, 'green')}}
    h1{margin-top:26px;font-size:62px;line-height:1.03;font-weight:780;letter-spacing:-.04em}
    p{margin-top:22px;font-size:21px;line-height:1.45;color:${t.ink2}}
    .states{display:flex;align-items:flex-end;gap:34px}
    .states div{display:flex;flex-direction:column;align-items:center;gap:22px}
    .states span{display:grid;place-items:center;width:150px;height:170px}
    .states b{font-size:15px;font-weight:600;color:${t.ink2}}
    .good{${orb(54, 'green')}} .elevated{${orb(92, 'amber')}} .loud{${orb(134, 'red')}}`);

const insights = (t, theme) => page(t, 1200, 760, `
    ${frame(t, shot(theme, '8-insights-day'), 1040)}`, `
    .card{display:grid;place-items:end center;padding:64px 0 0}
    .window{border-bottom:0;border-radius:14px 14px 0 0}
    ${frameCss(t)}`);

const welcome = (t, theme) => page(t, 1200, 600, `
    <div class="row">
        ${frame(t, shot(theme, '3-try'), 320)}
        ${frame(t, shot(theme, '4-speakers'), 320)}
        ${frame(t, shot(theme, '4b-done'), 320)}
    </div>`, `
    .card{display:grid;place-items:center}
    .row{display:flex;gap:36px;align-items:center}
    ${frameCss(t)}`);

async function render(html, width, height, scale) {
    const win = new BrowserWindow({
        width, height, show: false, useContentSize: true, transparent: true,
        webPreferences: { offscreen: true, webSecurity: false } // Local screenshots by file:// URL
    });
    const file = path.join(os.tmpdir(), `sound-meter-readme-${process.pid}.html`);
    fs.writeFileSync(file, html);
    await win.loadFile(file);
    fs.unlinkSync(file);
    // Capture at twice the size so it is crisp on a Retina screen.
    win.webContents.enableDeviceEmulation({
        screenPosition: 'desktop', screenSize: { width, height }, viewSize: { width, height },
        viewPosition: { x: 0, y: 0 }, deviceScaleFactor: scale, scale: 1
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    const image = await win.webContents.capturePage();
    win.destroy();
    return image;
}

async function write(name, html, width, height) {
    const target = path.join(root, 'docs', 'readme', name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const image = await render(html, width, height, 2);
    fs.writeFileSync(target, image.toPNG());
    const { width: w, height: h } = image.getSize();
    console.log(`Wrote docs/readme/${name} (${w}×${h}, ${Math.round(fs.statSync(target).size / 1024)} KB)`);
}

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sound-meter-readme-')));
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
    try {
        for (const [theme, t] of Object.entries(THEMES)) {
            const needed = ['8-insights-day', '3-try', '4-speakers', '4b-done'].filter((name) => !fs.existsSync(path.join(shots, `${theme}-${name}.png`)));
            if (needed.length) throw new Error(`Missing ${theme} screenshots in ${shots}: ${needed.join(', ')}. Run the smoke test in that theme first.`);
            await write(`hero-${theme}.png`, hero(t), 1200, 480);
            await write(`insights-${theme}.png`, insights(t, theme), 1200, 760);
            await write(`welcome-${theme}.png`, welcome(t, theme), 1200, 600);
        }
        app.exit(0);
    } catch (error) {
        console.error(error.message);
        app.exit(1);
    }
});
