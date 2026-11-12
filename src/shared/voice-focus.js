// Voice Focus asks the audio engine to cancel everything the Mac is playing
// out of the microphone signal, so speakers don't count as you. To do that
// macOS must let the app hear system audio (it asks once). Shared by the orb
// and the welcome window.
(() => {
    // A stream macOS has refused ends within this long of opening.
    const SETTLE_MS = 3000;

    /** Opens the microphone; without Voice Focus the request is exactly as it always was. */
    function open(deviceId, voiceFocus) {
        const audio = deviceId ? { deviceId: { exact: deviceId } } : {};
        if (voiceFocus) audio.echoCancellation = 'all';
        return navigator.mediaDevices.getUserMedia({ audio: Object.keys(audio).length ? audio : true });
    }

    /** Whether a stream really is cancelling system audio. */
    function cancelling(stream) {
        const track = stream.getAudioTracks()[0];
        return !!track && track.readyState === 'live' && track.getSettings().echoCancellation === 'all';
    }

    /**
     * Asks for Voice Focus once (this is what brings up the macOS prompt) and
     * says how it went: 'granted' or 'refused'. Waits as long as the prompt
     * is on screen.
     */
    async function request() {
        let stream = null;
        try {
            stream = await open(null, true);
            if (!cancelling(stream)) return 'refused';
            const track = stream.getAudioTracks()[0];
            const ended = await new Promise((resolve) => {
                track.addEventListener('ended', () => resolve(true), { once: true });
                setTimeout(() => resolve(false), SETTLE_MS);
            });
            return ended ? 'refused' : 'granted';
        } catch {
            return 'refused';
        } finally {
            if (stream) stream.getTracks().forEach((track) => track.stop());
        }
    }

    window.VoiceFocus = { SETTLE_MS, open, cancelling, request };
})();
