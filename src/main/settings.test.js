const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSettings, supportsVoiceFocus, DEFAULTS } = require('./settings');

describe('settings', () => {
    let dir;
    let file;
    const write = (data) => fs.writeFileSync(file, JSON.stringify(data));
    const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-settings-'));
        file = path.join(dir, 'settings.json');
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('a new install starts with Voice Focus on and automatic sensitivity', () => {
        const settings = createSettings(file);
        expect(settings.get('voiceFocus')).toBe(true);
        expect(settings.get('sensitivityMode')).toBe('auto');
        expect(fs.existsSync(file)).toBe(false); // Nothing is written until something changes
    });

    test('an install from before Voice Focus was the default has it switched on once', () => {
        write({ onboarded: true, sensitivityMode: 'manual', sensitivity: 210, voiceFocus: false, position: { x: 2801, y: 30 } });
        const settings = createSettings(file);
        expect(settings.get('voiceFocus')).toBe(true);
        // ...and its saved corner becomes the orb's centre, so the orb stays put.
        expect(settings.get('position')).toEqual({ x: 2885, y: 114 });
        expect(createSettings(file).get('position')).toEqual({ x: 2885, y: 114 });
        expect(settings.get('sensitivity')).toBe(210);
        expect(read()).toMatchObject({ voiceFocus: true, revision: DEFAULTS.revision, sensitivity: 210 });
    });

    test('turning Voice Focus off afterwards sticks', () => {
        write({ onboarded: true, voiceFocus: false });
        createSettings(file).update({ voiceFocus: false });
        expect(createSettings(file).get('voiceFocus')).toBe(false);
        expect(read().voiceFocus).toBe(false);
    });

    test('people who set up before automatic sensitivity keep their manual level', () => {
        write({ onboarded: true, sensitivity: 100 });
        expect(createSettings(file).get('sensitivityMode')).toBe('manual');
    });

    test('unknown keys and the revision cannot be patched', () => {
        const settings = createSettings(file);
        expect(settings.update({ revision: 0, nonsense: 1 })).toBe(false);
        expect(settings.get('revision')).toBe(DEFAULTS.revision);
        expect(settings.all()).not.toHaveProperty('nonsense');
    });

    test('a corrupt file falls back to defaults', () => {
        fs.writeFileSync(file, '{not json');
        expect(createSettings(file).all()).toEqual({ ...DEFAULTS });
    });
});

describe('supportsVoiceFocus', () => {
    test.each([
        ['darwin', '13.6.1', false],
        ['darwin', '14.1.0', false],
        ['darwin', '14.2.0', true],
        ['darwin', '15.0', true],
        ['darwin', '26.0.1', true],
        ['darwin', '', false],
        ['win32', '10.0.22631', false]
    ])('%s %s -> %s', (platform, version, expected) => {
        expect(supportsVoiceFocus(platform, version)).toBe(expected);
    });
});
