// Renders the static artwork that ships with the app and website:
//   assets/dmg/background.png (+@2x)   installer window background
//   landing_page/public/og.png         social share card
//   landing_page/public/apple-touch-icon.png
//
// Run with: npm run assets   (uses Electron as a headless renderer)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');

const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif`;
const ORB = (size) => `
    width:${size}px;height:${size}px;border-radius:50%;
    background:
        radial-gradient(circle at 32% 28%, rgba(255,255,255,.6), rgba(255,255,255,0) 46%),
        radial-gradient(circle at 50% 55%, rgba(48,209,88,.96), rgba(48,209,88,.74));
    box-shadow: 0 0 ${size * 0.45}px rgba(48,209,88,.5), inset 0 -${size * 0.1}px ${size * 0.2}px rgba(0,0,0,.12),
        inset 0 0 0 1px rgba(255,255,255,.28);`;

const page = (width, height, body, css = '') => `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0}
    html,body{width:${width}px;height:${height}px;overflow:hidden;font-family:${FONT};-webkit-font-smoothing:antialiased}
    ${css}</style>${body}`;

// Icons sit at x=180 and x=480, y=215 (see "dmg.contents" in package.json).
const dmg = page(660, 420, `
    <div class="bg">
        <h1>Drag Sound Meter into Applications</h1>
        <p>Then open it from Launchpad or Spotlight.</p>
        <svg class="arrow" viewBox="0 0 120 40">
            <path d="M6 20h80" fill="none" stroke="#0a2540" stroke-opacity=".38" stroke-width="5"
                stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="0.1 13"/>
            <path d="M90 6l16 14-16 14" fill="none" stroke="#0a2540" stroke-opacity=".45" stroke-width="5"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <i class="pad" style="left:180px"></i><i class="pad" style="left:480px"></i>
    </div>`, `
    .bg{position:relative;width:100%;height:100%;text-align:center;color:#0a2540;
        background:
            radial-gradient(60% 70% at 18% 0%, rgba(48,209,88,.20), transparent 70%),
            radial-gradient(50% 60% at 100% 100%, rgba(255,204,0,.14), transparent 70%),
            linear-gradient(#fbfcfe,#eef2f7)}
    h1{padding-top:44px;font-size:23px;font-weight:700;letter-spacing:-.02em}
    p{margin-top:6px;font-size:13.5px;color:#5b6b7f}
    .arrow{position:absolute;left:270px;top:195px;width:120px;height:40px}
    .pad{position:absolute;top:215px;width:168px;height:168px;margin:-78px 0 0 -84px;border-radius:32px;
        background:rgba(255,255,255,.55);box-shadow:inset 0 0 0 1px rgba(10,37,64,.06)}`);

const og = page(1200, 630, `
    <div class="bg">
        <div class="copy">
            <div class="brand"><i></i>Shhh.it</div>
            <h1>Know when you’re<br>getting loud.</h1>
            <p>A tiny floating sound meter for your Mac.<br>Free, private, open source.</p>
        </div>
        <div class="stage"><b></b><b></b><b></b><div class="orb"></div></div>
    </div>`, `
    .bg{position:relative;width:100%;height:100%;display:flex;align-items:center;padding:0 84px;color:#0a2540;
        background:
            radial-gradient(50% 80% at 82% 45%, rgba(48,209,88,.26), transparent 70%),
            radial-gradient(40% 60% at 100% 100%, rgba(255,204,0,.20), transparent 70%),
            radial-gradient(40% 60% at 0% 0%, rgba(48,209,88,.10), transparent 70%),
            #f8fafc}
    .brand{display:flex;align-items:center;gap:14px;font-size:30px;font-weight:650;letter-spacing:-.01em}
    .brand i{${ORB(30)}}
    h1{margin-top:36px;font-size:86px;line-height:1.02;font-weight:750;letter-spacing:-.04em}
    p{margin-top:30px;font-size:33px;line-height:1.35;color:#4b5d73}
    .stage{position:absolute;right:120px;top:50%;width:0;height:0}
    .stage b{position:absolute;left:0;top:0;border-radius:50%;border:2px solid rgba(48,209,88,.28);transform:translate(-50%,-50%)}
    .stage b:nth-child(1){width:300px;height:300px}
    .stage b:nth-child(2){width:420px;height:420px;opacity:.6}
    .stage b:nth-child(3){width:540px;height:540px;opacity:.3}
    .orb{position:absolute;margin:-90px 0 0 -90px;${ORB(180)}}`);

const touchIcon = page(180, 180, `<div class="bg"><div class="orb"></div></div>`, `
    .bg{width:100%;height:100%;display:grid;place-items:center;background:linear-gradient(#ffffff,#eef3f8)}
    .orb{${ORB(104)}}`);

async function render(html, width, height, scale) {
    const win = new BrowserWindow({
        width: width * scale,
        height: height * scale,
        show: false,
        useContentSize: true,
        webPreferences: { offscreen: true }
    });
    const file = path.join(os.tmpdir(), `sound-meter-asset-${process.pid}.html`);
    fs.writeFileSync(file, html);
    await win.loadFile(file);
    fs.unlinkSync(file);
    win.webContents.setZoomFactor(scale);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const image = await win.webContents.capturePage();
    win.destroy();
    const size = image.getSize();
    const want = { width: width * scale, height: height * scale };
    return size.width === want.width ? image : image.resize(want);
}

async function write(file, html, width, height, scale = 1) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, (await render(html, width, height, scale)).toPNG());
    console.log(`Wrote ${file}`);
}

// Keep this run's Chromium profile out of the real user data directory.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sound-meter-assets-')));

// Windows come and go between renders; don't quit when the last one closes.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
    try {
        await write('assets/dmg/background.png', dmg, 660, 420, 1);
        await write('assets/dmg/background@2x.png', dmg, 660, 420, 2);
        await write('landing_page/public/og.png', og, 1200, 630, 1);
        await write('landing_page/public/apple-touch-icon.png', touchIcon, 180, 180, 1);
        app.exit(0);
    } catch (error) {
        console.error(error);
        app.exit(1);
    }
});
