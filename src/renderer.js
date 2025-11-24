// Renderer process
const { ipcRenderer } = require('electron');
const { calculateSize, calculateColor, CONSTANTS } = require('./utils/audio-visualizer');

const meterCircle = document.getElementById('meter-circle');
const micSelect = document.getElementById('mic-select');
const sensitivitySelect = document.getElementById('sensitivity-select');
const controls = document.getElementById('controls');
const appContainer = document.getElementById('app-container');

let hideTimeout;

function scheduleHide(delay = 3000) {
    if (hideTimeout) clearTimeout(hideTimeout);
    controls.classList.add('visible');
    hideTimeout = setTimeout(() => {
        controls.classList.remove('visible');
    }, delay);
}

// Show on hover/move and reset timer
const onActivity = () => scheduleHide(3000);
appContainer.addEventListener('mouseenter', onActivity);
appContainer.addEventListener('mousemove', onActivity);

// Hide quickly when leaving or selecting
appContainer.addEventListener('mouseleave', () => scheduleHide(500));

micSelect.addEventListener('change', (e) => {
    startListening(e.target.value);
    scheduleHide(500);
});

sensitivitySelect.addEventListener('change', (e) => {
    currentSensitivity = parseInt(e.target.value);
    scheduleHide(500);
});

let audioContext;
let analyser;
let microphone;
let dataArray;
let currentSensitivity = CONSTANTS.SENSITIVITY_PRESETS.MEDIUM;

function initSensitivity() {
    const presets = CONSTANTS.SENSITIVITY_PRESETS;
    // Order: High (sensitive), Medium, Low (needs loud sound)
    const options = [
        { label: 'High Sensitivity', value: presets.HIGH },
        { label: 'Medium Sensitivity', value: presets.MEDIUM },
        { label: 'Low Sensitivity', value: presets.LOW },
        { label: 'Very Low Sensitivity', value: presets.VERY_LOW },
        { label: 'Ultra Low Sensitivity', value: presets.ULTRA_LOW }
    ];

    sensitivitySelect.innerHTML = '';
    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.text = opt.label;
        if (opt.value === currentSensitivity) option.selected = true;
        sensitivitySelect.appendChild(option);
    });
}

async function getMicrophones() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioDevices = devices.filter(device => device.kind === 'audioinput');

    micSelect.innerHTML = '';
    audioDevices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.text = device.label || `Microphone ${micSelect.length + 1}`;
        micSelect.appendChild(option);
    });
}

async function startListening(deviceId) {
    if (audioContext) {
        audioContext.close();
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined
            }
        });

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;

        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);

        dataArray = new Uint8Array(analyser.frequencyBinCount);

        updateMeter();
    } catch (err) {
        console.error('Error accessing microphone:', err);
    }
}

function updateMeter() {
    if (!analyser) return;

    analyser.getByteFrequencyData(dataArray);

    // Calculate average volume
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
    }
    const average = sum / dataArray.length;

    // Calculate visual properties using the utility module
    const size = calculateSize(average, currentSensitivity);
    const { r, g, b } = calculateColor(average, currentSensitivity);

    meterCircle.style.width = `${size}px`;
    meterCircle.style.height = `${size}px`;
    meterCircle.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 0.6)`;
    meterCircle.style.boxShadow = `0 0 ${20 + (average / 3)}px rgba(${r}, ${g}, ${b}, 0.5)`;

    requestAnimationFrame(updateMeter);
}

// Initialize
initSensitivity();
getMicrophones().then(() => {
    startListening();
});
