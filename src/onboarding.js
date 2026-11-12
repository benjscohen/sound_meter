// First-run welcome. One thing per step: settling into Applications if it
// was started from somewhere else, what it is, the microphone, seeing it
// react to your own voice, the speakers permission, and where to find it.
(() => {
    const api = window.soundMeter;
    const V = window.AudioVisualizer;
    const Voice = window.VoiceFocus;
    const { SENSITIVITY_OPTIONS, SENSITIVITY_PRESETS, ZONE_LABELS } = V.CONSTANTS;
    const $ = (id) => document.getElementById(id);

    const wizard = $('wizard');
    const steps = [...document.querySelectorAll('.step')];
    const dots = $('dots');
    const primary = $('primary');
    const secondary = $('secondary');
    const orb = $('preview-orb');
    const zoneLabel = $('zone-label');
    const sensitivityGroup = $('sensitivity');

    const HEARD_AFTER_FRAMES = 20;      // About a third of a second of real sound

    let flow = ['welcome', 'mic', 'try', 'speakers', 'done'];
    let step = 'welcome';
    let access = 'not-determined';
    let sensitivity = SENSITIVITY_PRESETS.MEDIUM;
    let auto = true;
    let choosing = false;               // Showing the sensitivity presets
    let speakers = 'idle';              // 'idle' | 'asking' | 'granted' | 'refused' | 'skipped'
    let moveFailed = false;
    let analyser = null;
    let stream = null;
    let data = null;
    let level = 0;
    let loudFrames = 0;
    let heard = false;
    let busy = false;

    /* -------------------------------------------------------------- orb */

    // Away from the "try it" step the orb just breathes, calm and green.
    const resting = (now) => 15 + 6 * Math.sin(now / 1300);

    function frame(now) {
        requestAnimationFrame(frame);
        const live = analyser && step === 'try';
        let max = SENSITIVITY_PRESETS.MEDIUM;
        let raw;
        if (live) {
            analyser.getByteFrequencyData(data);
            raw = V.averageLevel(data);
            if (!auto) max = sensitivity;
        } else {
            raw = resting(now);
        }

        level = live ? V.smoothLevel(level, raw, 0.35, 0.07) : V.smoothLevel(level, raw, 0.05, 0.05);
        const ratio = V.levelRatio(level, max);
        const shown = Math.min(ratio, 1);
        const { r, g, b } = V.colorForRatio(shown);
        orb.style.setProperty('--s', (1 + shown * 1.5).toFixed(3));
        orb.style.setProperty('--c', `${r} ${g} ${b}`);
        zoneLabel.textContent = live ? ZONE_LABELS[V.zoneForRatio(ratio)] : '';

        // The moment it first hears you is worth saying out loud.
        if (live && !heard) {
            loudFrames = ratio > 0.12 ? loudFrames + 1 : 0;
            if (loudFrames >= HEARD_AFTER_FRAMES) {
                heard = true;
                renderTry();
            }
        }
    }

    async function startMic() {
        if (stream) return true;
        try {
            stream = await Voice.open(null, false);
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

    function callout(id, text, kind = 'warn') {
        const el = $(id);
        el.hidden = !text;
        el.classList.toggle('ok', kind === 'ok');
        el.classList.toggle('note', kind === 'note');
        el.querySelector('span').textContent = text || '';
    }

    function renderMove() {
        if (moveFailed) {
            callout('move-callout', 'Sound Meter couldn’t move itself. Drag it into your Applications folder from the installer window, then open it from there.');
            primary.textContent = 'Continue';
        } else {
            callout('move-callout', '');
            primary.textContent = 'Move to Applications';
            secondary.hidden = false;
            secondary.textContent = 'Not now';
        }
    }

    // On to the step after this one or, when there isn't one, out.
    function proceed() {
        const next = flow[flow.indexOf(step) + 1];
        if (next) go(next);
        else api.closeOnboarding();
    }

    function renderMic() {
        secondary.hidden = false;
        secondary.textContent = 'Not now';
        if (access === 'denied' || access === 'restricted') {
            callout('mic-callout', 'Microphone access is turned off for Sound Meter. Switch it on in System Settings → Privacy & Security → Microphone, then come back.');
            primary.textContent = 'Open System Settings';
        } else {
            callout('mic-callout', '');
            primary.textContent = 'Allow Microphone';
        }
    }

    // "Auto" learns your voice once the meter is running; the presets are
    // there, one click away, for anyone who'd rather choose.
    function renderTry() {
        primary.textContent = 'Continue';
        $('try-title').textContent = analyser ? 'Now say something' : 'Almost there';
        $('try-copy').textContent = analyser
            ? 'Talk the way you normally would. The orb stays green at a comfortable volume and warms to red as you get louder.'
            : 'Without the microphone the orb can’t react yet. You can allow it any time from the menu bar icon.';
        callout('heard', analyser && heard ? 'It can hear you.' : '', 'ok');

        const choices = [{ label: 'Auto', value: 'auto' }, ...SENSITIVITY_OPTIONS];
        sensitivityGroup.hidden = !choosing;
        sensitivityGroup.replaceChildren(...choices.map((option) => {
            const selected = option.value === 'auto' ? auto : !auto && option.value === sensitivity;
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = option.label;
            button.setAttribute('aria-pressed', String(selected));
            button.addEventListener('click', () => {
                auto = option.value === 'auto';
                if (!auto) sensitivity = option.value;
                renderTry();
            });
            return button;
        }));
        const preset = SENSITIVITY_OPTIONS.find((o) => o.value === sensitivity);
        $('sensitivity-hint').textContent = auto
            ? 'It tunes itself to your voice over your first minute of talking.'
            : preset ? `Best for: ${preset.hint.toLowerCase()}` : '';
        $('sensitivity-toggle').hidden = choosing;
    }

    function renderSpeakers() {
        const note = 'macOS will ask to let Sound Meter hear what your Mac is playing. It’s only subtracted, never recorded.';
        primary.disabled = speakers === 'asking';
        secondary.hidden = speakers === 'granted' || speakers === 'refused';
        secondary.textContent = 'Not now';
        if (speakers === 'asking') {
            callout('speakers-callout', note, 'note');
            primary.textContent = 'Waiting for macOS…';
        } else if (speakers === 'granted') {
            callout('speakers-callout', 'Done. Your speakers won’t count as you.', 'ok');
            primary.textContent = 'Continue';
        } else if (speakers === 'refused') {
            callout('speakers-callout', 'No problem. Sound Meter will measure everything the microphone hears. You can turn this on later in Settings.', 'note');
            primary.textContent = 'Continue';
        } else {
            callout('speakers-callout', note, 'note');
            primary.textContent = 'Allow';
        }
    }

    function render() {
        wizard.dataset.step = step;
        const at = flow.indexOf(step);
        steps.forEach((el) => {
            const index = flow.indexOf(el.dataset.name);
            el.classList.toggle('active', index === at);
            el.classList.toggle('past', index < at);
            el.inert = index !== at;
        });
        [...dots.children].forEach((dot, i) => dot.classList.toggle('on', i === at));
        secondary.hidden = true;
        primary.disabled = false;

        if (step === 'move') renderMove();
        else if (step === 'welcome') primary.textContent = 'Get started';
        else if (step === 'mic') renderMic();
        else if (step === 'try') renderTry();
        else if (step === 'speakers') renderSpeakers();
        else primary.textContent = 'Start Sound Meter';
    }

    async function go(target) {
        // No need to ask for a microphone we already have.
        if (target === 'mic') {
            access = await api.micAccess();
            if (access === 'granted') target = 'try';
        }
        // The speakers permission only means something once the microphone is on.
        if (target === 'speakers' && (access !== 'granted' || !flow.includes('speakers'))) target = 'done';

        step = target;
        if (step === 'try' && access === 'granted') await startMic();
        else stopMic();
        render();
    }

    async function askForSpeakers() {
        speakers = 'asking';
        render();
        const result = await Voice.request();
        if (speakers !== 'asking') return;         // "Not now" was pressed meanwhile
        speakers = result;
        if (step !== 'speakers') return;
        render();
        // A yes needs no further decision: show it, then move on.
        if (result === 'granted') setTimeout(() => { if (step === 'speakers') go('done'); }, 1200);
    }

    async function finish() {
        primary.disabled = true;
        const decided = speakers === 'granted' || speakers === 'refused' || speakers === 'skipped';
        await api.finishOnboarding({
            sensitivity,
            sensitivityMode: auto ? 'auto' : 'manual',
            launchAtLogin: $('launch-at-login').checked,
            weeklyRecap: $('weekly-recap').checked,
            // Left alone, Voice Focus keeps its default and asks when the orb first listens.
            voiceFocus: decided ? speakers === 'granted' : undefined
        });
    }

    async function onPrimary() {
        if (busy) return;
        busy = true;
        try {
            if (step === 'move') {
                if (!moveFailed) {
                    primary.disabled = true;
                    // When this works the copy in Applications opens and this one quits.
                    const { moved } = await api.moveToApplications();
                    if (moved) return;
                    moveFailed = true;
                    render();
                } else {
                    proceed();
                }
            } else if (step === 'welcome') {
                await go('mic');
            } else if (step === 'mic') {
                if (access === 'denied' || access === 'restricted') {
                    api.openMicSettings();
                } else {
                    access = await api.requestMicAccess();
                    if (access === 'granted') await go('try');
                    else renderMic();
                }
            } else if (step === 'try') {
                await go('speakers');
            } else if (step === 'speakers') {
                if (speakers === 'idle') askForSpeakers();
                else await go('done');
            } else {
                await finish();
            }
        } finally {
            busy = false;
        }
    }

    primary.addEventListener('click', onPrimary);
    secondary.addEventListener('click', async () => {
        if (step === 'move') {
            await api.stayPut();
            proceed();
        } else if (step === 'mic') {
            go('try');
        } else if (step === 'speakers') {
            speakers = 'skipped';
            go('done');
        }
    });
    $('sensitivity-toggle').addEventListener('click', () => {
        choosing = true;
        renderTry();
    });

    // Coming back from System Settings: pick up the new permission.
    window.addEventListener('focus', async () => {
        if (step !== 'mic') return;
        access = await api.micAccess();
        if (access === 'granted') go('try');
        else renderMic();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') onPrimary();
    });

    api.getState().then((state) => {
        if (Number.isFinite(state.settings.sensitivity)) sensitivity = state.settings.sensitivity;
        auto = state.settings.sensitivityMode !== 'manual';
        choosing = !auto;
        // A Mac that can't do Voice Focus is never asked about it.
        if (state.voiceSupported === false) flow = flow.filter((name) => name !== 'speakers');
        // Started from the installer or Downloads: settle in first. Someone
        // who is already set up is asked that and nothing else.
        if (state.offerMove) flow = state.settings.onboarded ? ['move'] : ['move', ...flow];
        step = flow[0];
        if (flow.length > 1) dots.replaceChildren(...flow.map(() => document.createElement('i')));
        // Every message box shares the same pair of icons.
        document.querySelectorAll('.callout').forEach((el) => el.prepend($('callout-icons').content.cloneNode(true)));
        render();
        requestAnimationFrame(frame);
    });
})();
