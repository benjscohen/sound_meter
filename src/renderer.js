// Floating meter window. Listens to the microphone, drives the orb, and
// reports one loudness sample per second to the main process.
(() => {
    const api = window.soundMeter;
    const V = window.AudioVisualizer;
    const { ZONE_LABELS } = V.CONSTANTS;

    const stage = document.getElementById('stage');
    const orb = document.getElementById('orb');
    const pill = document.getElementById('pill');
    const options = document.getElementById('options');

    const ORB_SIZES = V.CONSTANTS.ORB_DIAMETERS;
    const ALERT_AFTER_MS = 1500;     // Sustained loudness before the ripple
    const DRAG_THRESHOLD = 4;        // Pixels of movement that turn a click into a drag
    const LABEL_GAP = 6;             // Closest a label comes to the side of the screen
    const LABEL_DROP = 80;           // Room a label needs below the orb's centre
    const RETRY_MS = 4000;
    const HOVER_GRACE_MS = 400;      // Time to travel from the orb to the Options button

    let state = null;
    let stream = null;
    let audioContext = null;
    let analyser = null;
    let data = null;
    let activeKey = null;            // What the current stream was opened for
    let starting = false;
    let restart = false;             // Settings changed while a start was in flight
    let level = 0;
    let loudSince = 0;
    let second = { sum: 0, raw: 0, n: 0, peak: 0, startedAt: 0 };
    let noticeTimer = null;
    let maxGain = ORB_SIZES.medium[1] / ORB_SIZES.medium[0] - 1;

    /* ------------------------------------------------------------ status */

    // The orb can sit right against a screen edge, where a label centred
    // under it would run off the screen: slide each one sideways just far
    // enough to fit, and put them above the orb at the bottom of the screen.
    let room = { left: Infinity, right: Infinity, below: Infinity };

    function placeLabels() {
        stage.classList.toggle('labels-above', room.below < LABEL_DROP);
        for (const label of [pill, options]) {
            const half = label.offsetWidth / 2 + LABEL_GAP;
            const shift = Math.max(0, half - room.left) - Math.max(0, half - room.right);
            label.style.setProperty('--shift', `${Math.round(shift)}px`);
        }
    }

    function setMode(mode, message) {
        stage.dataset.state = mode;
        if (mode !== 'listening') {
            stage.classList.remove('alert');
            orb.style.removeProperty('--s');
            orb.style.removeProperty('--c');
        }
        if (message) pill.textContent = message;
        // Problems stay visible; normal states only show the pill on hover.
        stage.classList.toggle('notice', mode === 'denied' || mode === 'no-device' || mode === 'idle');
        placeLabels();
        const status = mode === 'denied' || mode === 'no-device' ? mode : mode === 'listening' ? 'granted' : null;
        if (status) api.reportMicStatus(status);
    }

    function flashNotice(message, ms = 4500) {
        pill.textContent = message;
        placeLabels();
        stage.classList.add('notice');
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(() => {
            if (stage.dataset.state === 'listening' || stage.dataset.state === 'paused') {
                stage.classList.remove('notice');
            }
        }, ms);
    }

    /* ------------------------------------------------------------- audio */

    function stop() {
        if (stream) stream.getTracks().forEach((track) => track.stop());
        if (audioContext) audioContext.close().catch(() => {});
        stream = null;
        audioContext = null;
        analyser = null;
        level = 0;
    }

    async function refreshDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const inputs = devices
                .filter((d) => d.kind === 'audioinput' && d.deviceId)
                .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
            api.reportDevices(inputs);
            return inputs;
        } catch {
            return [];
        }
    }

    // How Voice Focus is asked for lives in shared/voice-focus.js.
    const { open, cancelling } = window.VoiceFocus;

    const VOICE_OPEN_MS = 3000;     // Longer than this to open means macOS is asking: listen normally meanwhile
    const VOICE_SETTLE_MS = window.VoiceFocus.SETTLE_MS;
    const VOICE_PROBE_MS = 5000;    // How often to check whether permission has arrived
    const VOICE_PROBES = 12;        // ...and for how long (a minute), then wait to be asked
    let voiceBlocked = false;       // Wanted, but macOS won't let us hear system audio
    let voiceRetry = 0;
    let probeTimer = null;
    let probesLeft = 0;
    let lateVoice = null;           // A Voice Focus stream that arrived after we stopped waiting for it

    // Wanted, and something this Mac can do.
    const wantsVoice = (s = state) => !!s.settings.voiceFocus && s.voiceSupported !== false;
    const release = (opened) => opened && opened.getTracks().forEach((track) => track.stop());
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function reportVoice(voice) {
        stage.dataset.voice = voice;
        api.reportVoice(voice);
    }

    // While blocked we listen normally, and quietly check now and then
    // whether the permission has been granted, so it starts working without
    // anyone having to come back and press anything.
    function scheduleProbe() {
        clearTimeout(probeTimer);
        if (!voiceBlocked || probesLeft <= 0) return;
        probesLeft -= 1;
        probeTimer = setTimeout(async () => {
            if (!voiceBlocked || !wantsVoice()) return;
            let trial = null;
            try {
                trial = await open(state.settings.deviceId, true);
                await new Promise((resolve) => setTimeout(resolve, 800));
                if (cancelling(trial)) {
                    voiceBlocked = false;
                    activeKey = null;
                    start();
                    return;
                }
            } catch {
                // Still not available.
            } finally {
                if (trial) trial.getTracks().forEach((track) => track.stop());
            }
            scheduleProbe();
        }, VOICE_PROBE_MS);
    }

    function blockVoice() {
        voiceBlocked = true;
        probesLeft = VOICE_PROBES;
        scheduleProbe();
    }

    // A working Voice Focus stream: use it, and notice if macOS takes it away.
    function useVoice(opened) {
        const openedAt = performance.now();
        opened.getAudioTracks()[0].addEventListener('ended', () => {
            if (stream !== opened) return;
            // Ending straight away means macOS refused; later it is
            // something else (a device change), so just start again.
            if (performance.now() - openedAt < VOICE_SETTLE_MS) blockVoice();
            activeKey = null;
            start();
        }, { once: true });
        reportVoice('on');
        return opened;
    }

    async function openWithFallback(deviceId, ready = null) {
        if (!wantsVoice()) {
            release(ready);
            voiceBlocked = false;
            clearTimeout(probeTimer);
            reportVoice('off');
            return open(deviceId, false);
        }
        if (ready) {
            if (cancelling(ready)) return useVoice(ready);
            release(ready);
        }
        if (!voiceBlocked) {
            const key = streamKey(state);
            const pending = open(deviceId, true);
            const opened = await Promise.race([pending, wait(VOICE_OPEN_MS)]);
            if (opened) {
                if (cancelling(opened)) return useVoice(opened);
                release(opened);
                blockVoice();
            } else {
                // macOS is still asking whether we may hear system audio.
                // Don't keep anyone waiting: listen normally now, and switch
                // over if and when the answer is yes.
                voiceBlocked = true;
                probesLeft = VOICE_PROBES;
                pending.then((late) => {
                    if (voiceBlocked && wantsVoice() && key === streamKey(state) && cancelling(late)) {
                        voiceBlocked = false;
                        lateVoice = late;
                        activeKey = null;
                        start();
                    } else {
                        release(late);
                        scheduleProbe();
                    }
                }, () => scheduleProbe());
            }
        }
        reportVoice('fallback');
        return open(deviceId, false);
    }

    const streamKey = (s) =>
        `${s.settings.deviceId || 'default'}|${s.settings.paused}|${!!s.idle}|${wantsVoice(s)}|${voiceRetry}`;

    // Size, opacity and symbols are preferences, applied whenever they change.
    function applyAppearance({ orbSize, orbOpacity, symbols }) {
        const [base, grown] = ORB_SIZES[orbSize] || ORB_SIZES.medium;
        maxGain = grown / base - 1;
        stage.style.setProperty('--orb', `${base}px`);
        stage.style.setProperty('--orb-opacity', String(orbOpacity === 0.75 || orbOpacity === 0.5 ? orbOpacity : 1));
        stage.classList.toggle('symbols', !!symbols);
    }

    async function start() {
        if (starting) {
            restart = true;
            return;
        }
        starting = true;
        const { deviceId, paused } = state.settings;
        const key = streamKey(state);

        try {
            stop();
            activeKey = key;
            const ready = lateVoice;
            lateVoice = null;
            if (paused || state.idle) release(ready);

            if (paused) {
                setMode('paused', 'Paused');
                return;
            }
            if (state.idle) {
                setMode('idle', 'Waiting for a call'); // Microphone released; the window is normally hidden
                return;
            }

            if (stage.dataset.state !== 'denied' && stage.dataset.state !== 'no-device') setMode('starting');

            let next;
            try {
                next = await openWithFallback(deviceId, ready);
            } catch (error) {
                // The saved microphone was unplugged: fall back to the default.
                if (deviceId && (error.name === 'OverconstrainedError' || error.name === 'NotFoundError')) {
                    next = await openWithFallback(null);
                    api.updateSettings({ deviceId: null });
                } else {
                    throw error;
                }
            }

            stream = next;
            audioContext = new AudioContext();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            audioContext.createMediaStreamSource(stream).connect(analyser);
            data = new Uint8Array(analyser.frequencyBinCount);
            second = { sum: 0, raw: 0, n: 0, peak: 0, startedAt: performance.now() };

            setMode('listening');

            const track = stream.getAudioTracks()[0];
            const label = track ? track.label.replace(/^Default - /, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '') : null;
            if (label && label !== state.settings.deviceLabel) api.updateSettings({ deviceLabel: label });
            refreshDevices();
        } catch (error) {
            stop();
            activeKey = null;
            if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
                setMode('denied', 'Allow microphone access');
            } else {
                setMode('no-device', 'No microphone found');
            }
        } finally {
            starting = false;
            if (restart) {
                restart = false;
                start();
            }
        }
    }

    function frame(now) {
        requestAnimationFrame(frame);
        if (!analyser || stage.dataset.state !== 'listening') return;

        analyser.getByteFrequencyData(data);
        const raw = V.averageLevel(data);
        const sensitivity = state.settings.sensitivity;

        level = V.smoothLevel(level, raw);
        const ratio = V.levelRatio(level, sensitivity);
        const shown = Math.min(ratio, 1);
        const { r, g, b } = V.colorForRatio(shown);
        orb.style.setProperty('--s', (1 + shown * maxGain).toFixed(3));
        orb.style.setProperty('--c', `${r} ${g} ${b}`);

        const zone = V.zoneForRatio(ratio);
        stage.dataset.zone = zone;
        if (zone === 'loud') {
            if (!loudSince) loudSince = now;
            stage.classList.toggle('alert', now - loudSince > ALERT_AFTER_MS);
        } else {
            loudSince = 0;
            stage.classList.remove('alert');
        }
        if (!stage.classList.contains('notice')) pill.textContent = ZONE_LABELS[zone];

        // History gets the unsmoothed truth, once a second.
        const rawRatio = V.levelRatio(raw, sensitivity);
        second.sum += rawRatio;
        second.raw += raw;
        second.n += 1;
        second.peak = Math.max(second.peak, rawRatio);
        if (now - second.startedAt >= 1000) {
            api.sendSample({ avg: second.sum / second.n, peak: second.peak, raw: second.raw / second.n });
            second = { sum: 0, raw: 0, n: 0, peak: 0, startedAt: now };
        }
    }

    /* ------------------------------------------------------- interaction */

    let hovering = false;
    let leaveTimer = null;
    let drag = null;

    function applyHover(over) {
        hovering = over;
        if (over) placeLabels();
        stage.classList.toggle('hover', over);
        api.setIgnoreMouse(!over);
    }

    // Hover starts at once but ends after a short grace period, so the
    // Options button doesn't vanish on the way to it.
    function setHover(over) {
        if (drag) return;
        if (over) {
            clearTimeout(leaveTimer);
            leaveTimer = null;
            if (!hovering) applyHover(true);
        } else if (hovering && !leaveTimer) {
            leaveTimer = setTimeout(() => {
                leaveTimer = null;
                applyHover(false);
            }, HOVER_GRACE_MS);
        }
    }

    // The window ignores the mouse (so clicks reach whatever is underneath)
    // except while the pointer is actually over the orb.
    window.addEventListener('mousemove', (event) => {
        setHover(!!(event.target instanceof Element && event.target.closest('.hit')));
    });
    document.addEventListener('mouseleave', () => setHover(false));

    orb.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        orb.setPointerCapture(event.pointerId);
        drag = { x: event.screenX, y: event.screenY, moved: false };
        api.dragStart();
    });

    orb.addEventListener('pointermove', (event) => {
        if (!drag) return;
        const dx = event.screenX - drag.x;
        const dy = event.screenY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.moved = true;
        stage.classList.add('dragging');
        api.dragMove(dx, dy);
    });

    function endDrag(event) {
        if (!drag) return;
        const wasClick = !drag.moved;
        drag = null;
        stage.classList.remove('dragging');
        if (orb.hasPointerCapture(event.pointerId)) orb.releasePointerCapture(event.pointerId);
        api.dragEnd();
        if (wasClick && event.type === 'pointerup') api.openInsights();
    }

    orb.addEventListener('pointerup', endDrag);
    orb.addEventListener('pointercancel', endDrag);
    orb.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        api.openMenu();
    });
    options.addEventListener('click', () => api.openSettings());
    orb.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') api.openInsights();
    });

    /* -------------------------------------------------------------- boot */

    function onState(next) {
        const first = !state;
        state = next;
        // "Try again" from Settings: forget that Voice Focus was refused.
        if (state.voiceRetry !== voiceRetry) {
            voiceRetry = state.voiceRetry;
            voiceBlocked = false;
        }
        applyAppearance(state.settings);
        if (first || streamKey(state) !== activeKey) start();
    }

    navigator.mediaDevices.addEventListener('devicechange', async () => {
        const inputs = await refreshDevices();
        const wanted = state && state.settings.deviceId;
        const lost = wanted && !inputs.some((d) => d.id === wanted);
        if (lost || stage.dataset.state === 'no-device') {
            activeKey = null;
            start();
        }
    });

    // If access was denied, keep quietly retrying so the orb comes alive the
    // moment the user flips the switch in System Settings.
    setInterval(() => {
        const mode = stage.dataset.state;
        if (state && !state.settings.paused && (mode === 'denied' || mode === 'no-device')) start();
    }, RETRY_MS);

    api.onState(onState);
    api.onNotice((message) => flashNotice(message, 6000));
    api.onMoved((around) => {
        room = around;
        placeLabels();
    });
    api.getState().then((initial) => {
        onState(initial);
        requestAnimationFrame(frame);
        setTimeout(() => {
            if (stage.dataset.state !== 'listening') return;
            const learning = state.settings.sensitivityMode === 'auto' && !state.settings.calibrated;
            flashNotice(learning ? 'Learning your voice…' : 'Click the orb to see your day', 8000);
        }, 900);
    });
})();
