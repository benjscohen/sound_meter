// The Settings view of the main window. Everything applies the moment it is
// changed, so several things can be adjusted in one go while watching the
// orb respond. The controls are built once; `sync` then keeps every one in
// step with the app's state (which can also change from the menu).
(() => {
    const api = window.soundMeter;
    const $ = (id) => document.getElementById(id);

    let state = null;
    let savedTimer = null;

    // A small "Saved" flash, so a change that has no visible effect on the
    // orb still gets an acknowledgement.
    function saved() {
        $('saved').classList.add('show');
        clearTimeout(savedTimer);
        savedTimer = setTimeout(() => $('saved').classList.remove('show'), 1400);
    }

    const change = async (patch) => {
        await api.updateSettings(patch);
        saved();
    };
    const act = async (name, value) => {
        await api.settingsAction(name, value);
        if (name !== 'quit') saved();
    };

    /* ---------------------------------------------------------- controls */

    // Simple on/off settings: <input type="checkbox" data-setting="key">
    document.querySelectorAll('input[data-setting]').forEach((input) => {
        input.addEventListener('change', () => change({ [input.dataset.setting]: input.checked }));
    });

    // One-of-several settings: <div class="segmented" data-choice="key">
    document.querySelectorAll('[data-choice]').forEach((group) => {
        group.addEventListener('click', (event) => {
            const button = event.target.closest('button[data-value]');
            if (!button) return;
            const raw = button.dataset.value;
            change({ [group.dataset.choice]: Number.isNaN(Number(raw)) ? raw : Number(raw) });
        });
    });

    // Buttons that do something: <button data-action="name">
    document.querySelectorAll('button[data-action]').forEach((button) => {
        button.addEventListener('click', () => act(button.dataset.action));
    });

    $('pause').addEventListener('click', () => change({ paused: !state.settings.paused }));
    $('relearn').addEventListener('click', () => act('relearn'));
    $('launch-at-login').addEventListener('change', (event) => act('launch-at-login', event.target.checked));
    $('update').addEventListener('click', () => act(state.update.status === 'ready' ? 'restart-to-update' : 'check-updates'));

    $('mic').addEventListener('change', (event) => {
        const device = state.devices.find((d) => d.id === event.target.value);
        if (device) change({ deviceId: device.id, deviceLabel: device.label });
    });

    $('calendar').addEventListener('change', async (event) => {
        // Turning it on may bring up the macOS permission prompt.
        await (event.target.checked ? api.connectCalendar() : api.disconnectCalendar());
        saved();
    });

    /* -------------------------------------------------------------- sync */

    function syncSensitivity() {
        const { sensitivityMode, sensitivity, calibrated } = state.settings;
        const auto = sensitivityMode === 'auto';
        const group = $('sensitivity');

        if (!group.children.length) {
            const choices = [{ label: 'Auto', value: 'auto' }, ...state.sensitivityOptions];
            group.replaceChildren(...choices.map((option) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = option.label;
                button.dataset.value = String(option.value);
                button.addEventListener('click', () => {
                    if (option.value === 'auto') {
                        if (state.settings.sensitivityMode !== 'auto') act('relearn');
                    } else {
                        change({ sensitivityMode: 'manual', sensitivity: option.value });
                    }
                });
                return button;
            }));
        }

        for (const button of group.children) {
            const isAuto = button.dataset.value === 'auto';
            button.setAttribute('aria-pressed', String(isAuto ? auto : !auto && Number(button.dataset.value) === sensitivity));
        }

        const preset = state.sensitivityOptions.find((o) => o.value === sensitivity);
        $('sensitivity-hint').textContent = auto
            ? calibrated ? 'Tuned to your voice.' : 'Learning your voice. It takes less than a minute of speech.'
            : preset ? `Best for: ${preset.hint.toLowerCase()}.` : '';
        $('relearn').hidden = !auto || !calibrated;
    }

    function syncMicrophones() {
        const select = $('mic');
        const wanted = state.settings.deviceId;
        const signature = state.devices.map((d) => `${d.id}:${d.label}`).join('|');
        if (select.dataset.signature !== signature) {
            select.dataset.signature = signature;
            select.replaceChildren(...state.devices.map((device) => {
                const option = document.createElement('option');
                option.value = device.id;
                option.textContent = device.label;
                return option;
            }));
        }
        select.disabled = state.devices.length === 0;
        if (document.activeElement !== select) {
            select.value = wanted && state.devices.some((d) => d.id === wanted) ? wanted : state.devices[0]?.id || '';
        }
    }

    function syncUpdate() {
        const { status, version } = state.update;
        const button = $('update');
        $('version').textContent = `Version ${state.version}`;
        button.disabled = status === 'checking' || status === 'downloading' || (!state.packaged && status !== 'ready');
        button.textContent = {
            ready: `Restart to update${version ? ` to ${version}` : ''}`,
            checking: 'Checking…',
            downloading: 'Downloading…'
        }[status] || 'Check for updates';
    }

    function sync(next) {
        state = next;
        const { settings } = state;

        $('status-text').textContent = state.status;
        $('status-dot').className = settings.paused || state.idle ? 'quiet'
            : state.micStatus === 'denied' || state.micStatus === 'no-device' ? 'warn' : '';
        $('pause').textContent = settings.paused ? 'Resume' : 'Pause';

        syncMicrophones();
        syncSensitivity();

        document.querySelectorAll('input[data-setting]').forEach((input) => {
            input.checked = !!settings[input.dataset.setting];
        });
        document.querySelectorAll('[data-choice]').forEach((group) => {
            for (const button of group.querySelectorAll('button[data-value]')) {
                button.setAttribute('aria-pressed', String(String(settings[group.dataset.choice]) === button.dataset.value));
            }
        });

        // Things that depend on what this Mac can do.
        $('calls-row').hidden = !state.nativeAvailable;
        $('calls-row').classList.toggle('off', !state.callsSupported);
        $('calls-row').querySelector('input').disabled = !state.callsSupported;
        $('calls-hint').textContent = state.callsSupported
            ? 'Hide the orb and release the microphone unless another app is using it.'
            : 'Needs macOS 14.2 or later.';
        $('calendar-row').hidden = !state.nativeAvailable;
        $('calendar').checked = !!settings.calendar;
        $('launch-at-login').checked = !!state.launchAtLogin;

        syncUpdate();
    }

    api.onState(sync);
    api.getState().then(sync);
})();
