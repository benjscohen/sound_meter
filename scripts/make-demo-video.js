// Renders the short product film on the website (landing_page/public/demo.mp4)
// from real screenshots of the app, so it never drifts from what ships.
//
//   1. npm run smoke                      (writes screenshots to ./shots)
//   2. npm run demo                       (needs ffmpeg on the PATH)
//
// Every frame is drawn by a page whose look depends only on the time it is
// given, then captured and handed to ffmpeg.
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const shots = path.resolve(process.env.SMOKE_OUT || path.join(root, 'shots'));
const out = path.join(root, 'landing_page', 'public');
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
const INTRO_END = 4.1;       // The orb has the stage until here
const SCENE_STEP = 3.1;      // A new screen every this many seconds
const SCENE_SHOWN = 3.3;     // ...each on screen this long (they overlap as they cross-fade)
const POSTER_AT = 1.0;

const shot = (name) => {
    const file = path.join(shots, `light-${name}.png`);
    if (!fs.existsSync(file)) throw new Error(`Missing screenshot ${file}. Run "npm run smoke" first.`);
    return pathToFileURL(file).href;
};

const SCENES = [
    { kicker: 'Day', title: 'See how your day sounded.', image: '8-insights-day' },
    { kicker: 'Trends', title: 'Spot when, where and with whom.', image: '10-insights-trends' },
    { kicker: 'Settings', title: 'Tune it once. It applies as you go.', image: '6d-settings' },
    { kicker: 'Share', title: 'Share your week, totals only.', image: '12-insights-share' }
];
const OUTRO_START = INTRO_END + SCENES.length * SCENE_STEP - 0.4;
const SECONDS = Math.ceil(OUTRO_START + 2.6);

const page = () => `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
html,body{width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden}
body{position:relative;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;color:#0a2540;
  -webkit-font-smoothing:antialiased;background:
  radial-gradient(60% 70% at 15% 0%,rgba(48,209,88,.20),transparent 70%),
  radial-gradient(50% 60% at 100% 100%,rgba(255,204,0,.16),transparent 70%),#f8fafc}
.scene{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0}
.orb{--c:48 209 88;width:120px;height:120px;border-radius:50%;
  background:radial-gradient(circle at 32% 28%,rgb(255 255 255/.6),rgb(255 255 255/0) 46%),radial-gradient(circle at 50% 55%,rgb(var(--c)/.96),rgb(var(--c)/.76));
  box-shadow:0 0 60px rgb(var(--c)/.55),inset 0 -12px 24px rgb(0 0 0/.12),inset 0 0 0 2px rgb(255 255 255/.28)}
.stage{height:330px;display:grid;place-items:center}
.pill{margin-top:6px;padding:8px 18px;border-radius:999px;background:#fff;border:1px solid #e3e8ee;color:#425466;font-size:20px;font-weight:500;
  box-shadow:0 1px 2px rgba(10,37,64,.06)}
h1{margin-top:30px;font-size:60px;line-height:1.05;font-weight:800;letter-spacing:-.045em}
.kicker{color:#17a34a;font-size:22px;font-weight:700}
h2{margin-top:8px;font-size:44px;line-height:1.1;font-weight:750;letter-spacing:-.035em}
.frame{width:900px;height:470px;margin-top:28px;overflow:hidden;border-radius:18px;border:1px solid #e3e8ee;background:#fff;
  box-shadow:0 2px 6px rgba(10,37,64,.05),0 40px 80px -30px rgba(10,37,64,.32)}
.frame img{display:block;width:100%}
.end p{margin-top:14px;font-size:26px;color:#425466}
.end .url{margin-top:22px;padding:12px 28px;border-radius:999px;background:#0a2540;color:#f8fafc;font-size:24px;font-weight:600}
</style>
<div class="scene" id="intro"><div class="stage"><div class="orb" id="orb"></div></div><div class="pill" id="zone"></div>
  <h1>Know when you’re getting loud.</h1></div>
${SCENES.map((s, i) => `<div class="scene" id="scene-${i}"><div class="kicker">${s.kicker}</div><h2>${s.title}</h2>
  <div class="frame"><img id="image-${i}" src="${shot(s.image)}"></div></div>`).join('')}
<div class="scene end" id="end"><div class="stage" style="height:210px"><div class="orb" id="orb-end"></div></div>
  <h1>Sound Meter</h1><p>A tiny orb for your Mac. Free and open source.</p><div class="url">shhh.it.com</div></div>
<script>
const GREEN=[48,209,88],AMBER=[255,204,0],RED=[255,69,58],Y=60/140;
const mix=(a,b,t)=>a.map((v,i)=>Math.round(v+(b[i]-v)*t));
const colour=(r)=>r<Y?mix(GREEN,AMBER,r/Y):mix(AMBER,RED,(r-Y)/(1-Y));
const clamp=(v)=>Math.min(1,Math.max(0,v));
const ease=(t)=>{t=clamp(t);return t*t*(3-2*t)};
// Fades a scene in over its first half second and out over its last.
const window_=(t,start,end,fade=.5)=>Math.min(ease((t-start)/fade),ease((end-t)/fade));
// The orb's level through the intro: calm, a build to "too loud", and back.
function level(t){
  const wobble=.06*Math.sin(t*9)+.04*Math.sin(t*23);
  const swell=ease((t-1.1)/1.4)-ease((t-3)/1.1);
  return clamp(.16+swell*.84+wobble*(.4+swell));
}
const zoneName=(r)=>r>=.75?'Too loud':r>=Y?'Getting loud':'Sounding good';
window.renderFrame=(t)=>{
  const set=(id,o)=>{document.getElementById(id).style.opacity=o.toFixed(3)};
  set('intro',window_(t,-1,${INTRO_END + 0.2}));
  const r=level(t);
  const orb=document.getElementById('orb');
  orb.style.transform='scale('+(1+r*1.25).toFixed(3)+')';
  orb.style.setProperty('--c',colour(r).join(' '));
  document.getElementById('zone').textContent=zoneName(r);
  ${SCENES.map((_, i) => {
        const start = INTRO_END + i * SCENE_STEP;
        return `{const o=window_(t,${start},${start + SCENE_SHOWN});set('scene-${i}',o);
    const p=clamp((t-${start})/${SCENE_SHOWN});
    document.getElementById('scene-${i}').style.transform='translateY('+((1-ease((t-${start})/.7))*26).toFixed(1)+'px)';
    document.getElementById('image-${i}').style.transform='translateY('+(-p*${SCENES[i].image.includes('share') ? 40 : 90}).toFixed(1)+'px)';}`;
    }).join('\n  ')}
  set('end',window_(t,${OUTRO_START},${SECONDS + 1}));
  document.getElementById('orb-end').style.transform='scale('+(1+.08*Math.sin(t*2.4)).toFixed(3)+')';
  return new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))));
};
</script>`;

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sound-meter-demo-')));
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
    const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-meter-frames-'));
    let code = 0;
    try {
        const html = path.join(frames, 'film.html');
        fs.writeFileSync(html, page());
        const win = new BrowserWindow({
            width: WIDTH, height: HEIGHT, show: false, useContentSize: true,
            webPreferences: { offscreen: true, webSecurity: false } // Local screenshots only
        });
        await win.loadFile(html);
        await win.webContents.executeJavaScript('Promise.all([...document.images].map((i) => i.decode()))');

        const total = SECONDS * FPS;
        for (let frame = 0; frame < total; frame++) {
            await win.webContents.executeJavaScript(`renderFrame(${frame / FPS})`);
            let image = await win.webContents.capturePage();
            if (image.getSize().width !== WIDTH) image = image.resize({ width: WIDTH, height: HEIGHT });
            fs.writeFileSync(path.join(frames, `f${String(frame).padStart(4, '0')}.png`), image.toPNG());
            if (frame === Math.round(POSTER_AT * FPS)) fs.writeFileSync(path.join(frames, 'poster.png'), image.toPNG());
        }
        win.destroy();

        fs.mkdirSync(out, { recursive: true });
        const ffmpeg = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
        ffmpeg('-framerate', String(FPS), '-i', path.join(frames, 'f%04d.png'),
            '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
            path.join(out, 'demo.mp4'));
        ffmpeg('-i', path.join(frames, 'poster.png'), '-q:v', '4', path.join(out, 'demo-poster.jpg'));

        const size = (name) => `${Math.round(fs.statSync(path.join(out, name)).size / 1024)} KB`;
        console.log(`Wrote demo.mp4 (${size('demo.mp4')}, ${SECONDS}s) and demo-poster.jpg (${size('demo-poster.jpg')})`);
    } catch (error) {
        console.error(error.message || error);
        code = 1;
    }
    // Tidy up before exiting: Electron must not run more script once it starts quitting.
    fs.rmSync(frames, { recursive: true, force: true });
    app.exit(code);
});
