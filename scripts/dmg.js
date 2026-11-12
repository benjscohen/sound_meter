// Builds the installer (.dmg) for each chip once electron-builder has made,
// signed and notarized the app. electron-builder's own dmg target writes the
// window layout with a Python library, and recent versions of Finder ignore
// the background it points to, leaving a blank white window. A layout that
// Finder itself wrote works everywhere, so we keep one in the repo
// (assets/dmg/DS_Store, recorded by scripts/record-dmg-layout.js) and copy it
// into every image. Nothing here needs Finder, so it is safe in CI.
//
// Wired up as electron-builder's "afterAllArtifactBuild" hook: the paths it
// returns are uploaded with the rest of the release.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// The installer window. Change anything visual here, then run
// `npm run dmg:layout` on a Mac to record the layout again.
const INSTALLER = {
    volume: 'Install Sound Meter',
    app: 'Sound Meter.app',
    window: { width: 660, height: 420 },    // Matches the background image
    iconSize: 112,
    textSize: 12,
    icons: { 'Sound Meter.app': [180, 215], Applications: [480, 215] },
    background: [path.join(ROOT, 'assets/dmg/background.png'), path.join(ROOT, 'assets/dmg/background@2x.png')],
    layout: path.join(ROOT, 'assets/dmg/DS_Store'),
    icon: path.join(ROOT, 'sound_meter.icns')
};

// Finder's "this folder has its own icon" flag, for the volume itself.
const HAS_CUSTOM_ICON = '0000000000000000040000000000000000000000000000000000000000000000';

const run = (command, args) => execFileSync(command, args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString();

// Letting go of a disk image can fail for a moment while macOS is still
// looking at it, so try a few times before giving up.
function detach(mountPoint) {
    for (let attempt = 1; ; attempt++) {
        try {
            run('hdiutil', ['detach', mountPoint, '-quiet']);
            return;
        } catch (error) {
            if (attempt === 5) {
                run('hdiutil', ['detach', mountPoint, '-quiet', '-force']);
                return;
            }
            execFileSync('sleep', ['2']);
        }
    }
}

/**
 * Lays out what the installer window shows. Without an app, a stand-in with
 * the same name takes its place: the layout only cares what things are called.
 */
function stage(dir, appPath) {
    fs.mkdirSync(path.join(dir, '.background'), { recursive: true });
    if (appPath) run('ditto', [appPath, path.join(dir, INSTALLER.app)]);
    else fs.mkdirSync(path.join(dir, INSTALLER.app));
    fs.symlinkSync('/Applications', path.join(dir, 'Applications'));
    // One image holding both the regular and the Retina background.
    run('tiffutil', ['-cathidpicheck', ...INSTALLER.background, '-out', path.join(dir, '.background', 'background.tiff')]);
    fs.copyFileSync(INSTALLER.icon, path.join(dir, '.VolumeIcon.icns'));
}

/** A writable image of `dir`, mounted for `use(mountPoint)` and then let go. */
function withWritableImage(dir, work, { mountPoint }, use) {
    const megabytes = Math.ceil(Number(run('du', ['-sm', dir]).split('\t')[0]) * 1.1) + 24;
    const image = path.join(work, 'writable.dmg');
    run('hdiutil', ['create', '-quiet', '-ov', '-srcfolder', dir, '-volname', INSTALLER.volume,
        '-fs', 'HFS+', '-format', 'UDRW', '-size', `${megabytes}m`, image]);
    run('hdiutil', ['attach', image, '-quiet', '-noautoopen', ...(mountPoint ? ['-nobrowse', '-mountpoint', mountPoint] : [])]);
    const mounted = mountPoint || path.join('/Volumes', INSTALLER.volume);
    try {
        run('xattr', ['-wx', 'com.apple.FinderInfo', HAS_CUSTOM_ICON, mounted]);
        use(mounted);
    } finally {
        detach(mounted);
    }
    return image;
}

/** Builds the compressed, read-only installer for the app at `appPath`. */
function build(appPath, outFile) {
    if (!fs.existsSync(INSTALLER.layout)) throw new Error('assets/dmg/DS_Store is missing: run `npm run dmg:layout` on a Mac');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-meter-dmg-'));
    try {
        const dir = path.join(work, 'stage');
        stage(dir, appPath);
        fs.copyFileSync(INSTALLER.layout, path.join(dir, '.DS_Store'));
        const image = withWritableImage(dir, work, { mountPoint: path.join(work, 'mount') }, () => {});
        run('hdiutil', ['convert', image, '-quiet', '-ov', '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-o', outFile]);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
    return outFile;
}

// electron-builder hook: one installer per chip it packaged.
async function afterAllArtifactBuild({ outDir }) {
    const { version } = require('../package.json');
    const installers = [];
    for (const entry of fs.readdirSync(outDir)) {
        const match = /^mac(?:-(arm64|x64))?$/.exec(entry);
        const appPath = path.join(outDir, entry, INSTALLER.app);
        if (!match || !fs.existsSync(appPath)) continue;
        const chip = match[1] || 'x64';
        console.log(`  • building        target=DMG arch=${chip}`);
        installers.push(build(appPath, path.join(outDir, `Sound-Meter-${version}-${chip}.dmg`)));
    }
    return installers;
}

module.exports = { default: afterAllArtifactBuild, INSTALLER, build, stage, withWritableImage };
