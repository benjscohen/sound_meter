// Records how the installer window looks (assets/dmg/DS_Store), by letting
// Finder arrange a stand-in image exactly as scripts/dmg.js describes it.
// Run on a Mac whenever the installer's design changes:
//
//   npm run dmg:layout
//
// It opens a Finder window for a moment. Every installer built afterwards
// gets a copy of what it records.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { INSTALLER, stage, withWritableImage } = require('./dmg');

const TITLE_BAR = 28;
const { width, height } = INSTALLER.window;
const [left, top] = [400, 200];

const mounted = path.join('/Volumes', INSTALLER.volume);
if (fs.existsSync(mounted)) {
    console.error(`"${INSTALLER.volume}" is already open. Eject it and run this again.`);
    process.exit(1);
}

const positions = Object.entries(INSTALLER.icons)
    .map(([name, [x, y]]) => `set position of item "${name}" of win to {${x}, ${y}}`)
    .join('\n        ');

const arrange = `
tell application "Finder"
    tell disk "${INSTALLER.volume}"
        open
        set win to container window
        set current view of win to icon view
        set toolbar visible of win to false
        set statusbar visible of win to false
        set bounds of win to {${left}, ${top}, ${left + width}, ${top + height + TITLE_BAR}}
        set opts to icon view options of win
        set arrangement of opts to not arranged
        set icon size of opts to ${INSTALLER.iconSize}
        set text size of opts to ${INSTALLER.textSize}
        set shows icon preview of opts to false
        set shows item info of opts to false
        set background picture of opts to file ".background:background.tiff"
        ${positions}
        update without registering applications
        delay 1
        close
        open
        delay 1
        close
    end tell
end tell`;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-meter-dmg-layout-'));
try {
    const dir = path.join(work, 'stage');
    stage(dir, null);
    withWritableImage(dir, work, {}, (volume) => {
        execFileSync('osascript', ['-e', arrange], { stdio: 'inherit' });
        // Finder writes the layout a moment after the window closes.
        const layout = path.join(volume, '.DS_Store');
        for (let waited = 0; waited < 20 && !(fs.existsSync(layout) && fs.statSync(layout).size > 0); waited++) {
            execFileSync('sleep', ['0.5']);
        }
        execFileSync('sync');
        fs.copyFileSync(layout, INSTALLER.layout);
    });
    console.log(`Recorded ${path.relative(process.cwd(), INSTALLER.layout)} (${fs.statSync(INSTALLER.layout).size} bytes)`);
} finally {
    fs.rmSync(work, { recursive: true, force: true });
}
