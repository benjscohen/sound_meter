// First-run welcome: explain the orb, get microphone access, calibrate.
(() => {
    const api = window.soundMeter;
    const V = window.AudioVisualizer;
    const { SENSITIVITY_OPTIONS, SENSITIVITY_PRESETS, ZONE_LABELS } = V.CONSTANTS;

    const wizard = document.getElementById('wizard');
    const steps = [...document.querySelectorAll('.step')];
    const dots = [...document.querySelectorAll('.dots i')];
    const primary = document.getElementById('primary');
    const secondary = document.getElementById('secondary');
    const orb = document.getElementById('preview-orb');
    const zoneLabel = document.getElementById('zone-label');
    const callout = document.getElementById('mic-callout');
    const calloutText = document.getElementById('mic-callout-text');
    const sensitivityGroup = document.getElementById('sensitivity');
    const sensitivityHint = document.getElementById('sensitivity-hint');
    const calibrateCopy = document.getElementById('calibrate-copy');
    const launchAtLogin = document.getElementById('launch-at-login');

    const STEP = { WELCOME: 0, MIC: 1, CALIBRATE: 2, DONE: 3 };

    let step = STEP.WELCOME;
    let access = 'not-determined';
    let sensitivity = SENSITIVITY_PRESETS.MEDIUM;
    let auto = true;
    let analyser = null;
    let stream = null;
    let data = null;
    let level = 0;
    let busy = false;

    /* -------------------------------------------------------------- orb */

    // Before we have a microphone, the orb "talks" on its own so people
    // can see what it does.
    function simulatedLevel(t) {
        const phrase = Math.max(0, Math.sin(t / 1900));
        const syllables = 0.55 + 0.45 * Math.sin(t / 170) * Math.sin(t / 113);
        const swell = 0.5 + 0.5 * Math.sin(t / 5200);
        return phrase * syllables * (40 + swell * 110);
    }

    function frame(now) {
        requestAnimationFrame(frame);
        let raw;
        let max = auto ? SENSITIVITY_PRESETS.MEDIUM : sensitivity;
        if (analyser && step === STEP.CALIBRATE) {
            analyser.getByteFrequencyData(data);
            raw = V.averageLevel(data);
        } else {
            raw = simulatedLevel(now);
            max = SENSITIVITY_PRESETS.MEDIUM;
        }

        level = V.smoothLevel(level, raw, 0.35, 0.07);
        const ratio = V.levelRatio(level, max);
        const shown = Math.min(ratio, 1);
        const { r, g, b } = V.colorForRatio(shown);
        orb.style.setProperty('--s', (1 + shown * 1.5).toFixed(3));
        orb.style.setProperty('--c', `${r} ${g} ${b}`);
        zoneLabel.textContent = analyser ? ZONE_LABELS[V.zoneForRatio(ratio)] : '';
    }

    async function startMic() {
        if (stream) return true;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const context = new AudioContext();
            analyser = context.createAnalyser();
            analyser.fftSize = 256;
            context.createMediaStreamSource(stream).connect(analyser);
            data = new Uint8Array(analyser.frequencyBinCount);
            return true;
        } catch {
            stream = null;
            analyser = null;
            return false;
        }
    }

    function stopMic() {
        if (stream) stream.getTracks().forEach((track) => track.stop());
        stream = null;
        analyser = null;
    }

    /* ------------------------------------------------------------ steps */

    // "Auto" learns your voice once the meter is running; the presets are
    // there for anyone who'd rather choose.
    function renderSensitivity() {
        const choices = [{ label: 'Auto', value: 'auto' }, ...SENSITIVITY_OPTIONS];
        sensitivityGroup.replaceChildren(...choices.map((option) => {
            const selected = option.value === 'auto' ? auto : !auto && option.value === sensitivity;
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = option.label;
            button.setAttribute('aria-pressed', String(selected));
            button.addEventListener('click', () => {
                auto = option.value === 'auto';
                if (!auto) sensitivity = option.value;
                renderSensitivity();
            });
            return button;
        }));
        const current = SENSITIVITY_OPTIONS.find((o) => o.value === sensitivity);
        sensitivityHint.textContent = auto
            ? 'Sound Meter learns your normal voice as you talk. It takes less than a minute of speech.'
            : current ? `Best for: ${current.hint.toLowerCase()}` : '';
    }

    function showCallout(text, ok = false) {
        callout.hidden = !text;
        callout.classList.toggle('ok', ok);
        calloutText.textContent = text || '';
    }

    function renderMicStep() {
        secondary.hidden = false;
        secondary.textContent = 'Not now';
        if (access === 'granted') {
            showCallout('Microphone access is on. You’re good to go.', true);
            primary.textContent = 'Continue';
            secondary.hidden = true;
        } else if (access === 'denied' || access === 'restricted') {
            showCallout('Microphone access is turned off for Sound Meter. Switch it on in System Settings → Privacy & Security → Microphone, then come back.');
            primary.textContent = 'Open System Settings';
        } else {
            showCallout('');
            primary.textContent = 'Allow Microphone';
        }
    }

    function render() {
        wizard.dataset.step = String(step);
        steps.forEach((el, i) => {
            el.classList.toggle('active', i === step);
            el.classList.toggle('past', i < step);
            el.inert = i !== step;
        });
        dots.forEach((dot, i) => dot.classList.toggle('on', i === step));
        secondary.hidden = true;

        if (step === STEP.WELCOME) {
            primary.textContent = 'Get started';
        } else if (step === STEP.MIC) {
            renderMicStep();
        } else if (step === STEP.CALIBRATE) {
            primary.textContent = 'Looks good';
            calibrateCopy.textContent = analyser
                ? 'Say a sentence the way you’d normally talk. Leave it on Auto and Sound Meter tunes itself to your voice, or pick the setting where the orb stays green.'
                : 'Leave it on Auto and Sound Meter tunes itself to your voice once microphone access is on, or pick a starting point.';
            renderSensitivity();
        } else {
            primary.textContent = 'Start Sound Meter';
        }
    }

    async function go(next) {
        step = next;
        if (step === STEP.MIC) access = await api.micAccess();
        if (step === STEP.CALIBRATE && access === 'granted') await startMic();
        if (step === STEP.DONE) stopMic();
        render();
    }

    async function onPrimary() {
        if (busy) return;
        busy = true;
        try {
            if (step === STEP.WELCOME) {
                await go(STEP.MIC);
            } else if (step === STEP.MIC) {
                if (access === 'granted') {
                    await go(STEP.CALIBRATE);
                } else if (access === 'denied' || access === 'restricted') {
                    api.openMicSettings();
                } else {
                    access = await api.requestMicAccess();
                    if (access === 'granted') await go(STEP.CALIBRATE);
                    else renderMicStep();
                }
            } else if (step === STEP.CALIBRATE) {
                await go(STEP.DONE);
            } else {
                primary.disabled = true;
                await api.finishOnboarding({
                    sensitivity,
                    sensitivityMode: auto ? 'auto' : 'manual',
                    launchAtLogin: launchAtLogin.checked,
                    weeklyRecap: document.getElementById('weekly-recap').checked
                });
            }
        } finally {
            busy = false;
        }
    }

    primary.addEventListener('click', onPrimary);
    secondary.addEventListener('click', () => go(STEP.CALIBRATE));

    // Coming back from System Settings: pick up the new permission.
    window.addEventListener('focus', async () => {
        if (step !== STEP.MIC) return;
        access = await api.micAccess();
        renderMicStep();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') onPrimary();
    });

    api.getState().then((state) => {
        if (Number.isFinite(state.settings.sensitivity)) sensitivity = state.settings.sensitivity;
        auto = state.settings.sensitivityMode !== 'manual';
        render();
        requestAnimationFrame(frame);
    });
})();
