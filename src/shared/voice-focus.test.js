// The helper is a browser script; give it the two globals it touches.
function load(getUserMedia) {
    jest.resetModules();
    global.window = {};
    global.navigator = { mediaDevices: { getUserMedia } };
    require('./voice-focus');
    return global.window.VoiceFocus;
}

function fakeStream({ echoCancellation = 'all', readyState = 'live' } = {}) {
    const listeners = {};
    const track = {
        readyState,
        stopped: false,
        getSettings: () => ({ echoCancellation }),
        addEventListener: (name, fn) => { listeners[name] = fn; },
        stop() { this.stopped = true; }
    };
    return { track, end: () => listeners.ended && listeners.ended(), getAudioTracks: () => [track], getTracks: () => [track] };
}

afterEach(() => {
    jest.useRealTimers();
    delete global.window;
    delete global.navigator;
});

describe('VoiceFocus.open', () => {
    test('asks for plain audio unless Voice Focus is wanted', async () => {
        const getUserMedia = jest.fn(async () => fakeStream());
        const Voice = load(getUserMedia);
        await Voice.open(null, false);
        await Voice.open('mic-1', false);
        await Voice.open('mic-1', true);
        expect(getUserMedia.mock.calls.map(([c]) => c)).toEqual([
            { audio: true },
            { audio: { deviceId: { exact: 'mic-1' } } },
            { audio: { deviceId: { exact: 'mic-1' }, echoCancellation: 'all' } }
        ]);
    });
});

describe('VoiceFocus.request', () => {
    test('granted when the stream is cancelling and stays alive', async () => {
        jest.useFakeTimers();
        const stream = fakeStream();
        const Voice = load(async () => stream);
        const result = Voice.request();
        await jest.advanceTimersByTimeAsync(Voice.SETTLE_MS + 10);
        expect(await result).toBe('granted');
        expect(stream.track.stopped).toBe(true);
    });

    test('refused when macOS ends the stream straight away', async () => {
        jest.useFakeTimers();
        const stream = fakeStream();
        const Voice = load(async () => stream);
        const result = Voice.request();
        await jest.advanceTimersByTimeAsync(50);
        stream.end();
        expect(await result).toBe('refused');
        expect(stream.track.stopped).toBe(true);
    });

    test('refused when the stream is not cancelling system audio', async () => {
        const stream = fakeStream({ echoCancellation: true });
        const Voice = load(async () => stream);
        expect(await Voice.request()).toBe('refused');
        expect(stream.track.stopped).toBe(true);
    });

    test('refused when the microphone cannot be opened', async () => {
        const Voice = load(async () => { throw new Error('NotAllowedError'); });
        expect(await Voice.request()).toBe('refused');
    });
});
