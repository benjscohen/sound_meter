// Renderer process
const { ipcRenderer } = require('electron');

const meterCircle = document.getElementById('meter-circle');
const micSelect = document.getElementById('mic-select');
const controls = document.getElementById('controls');
const appContainer = document.getElementById('app-container');

let hideTimeout;

function showControls() {
    controls.classList.add('visible');
    if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
    }
}

function hideControls(delay = 2000) {
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
        controls.classList.remove('visible');
    }, delay);
}

// Show controls on hover
appContainer.addEventListener('mouseenter', () => {
    showControls();
});

// Hide controls after delay when leaving
appContainer.addEventListener('mouseleave', () => {
    hideControls(2000);
});

// Also show on mousemove to be safe (in case of window focus changes)
appContainer.addEventListener('mousemove', () => {
    showControls();
    // Optional: reset hide timer if we wanted auto-hide while hovering, 
    // but requirement says "After a few seconds of NOT hovering"
});

let audioContext;
let analyser;
let microphone;
let dataArray;

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

    // Map average (0-255) to visual properties
    // Increased sensitivity:
    // Yellow point: 60 (was 128)
    // Red point: 140 (was 255)

    const sensitivityMax = 140;
    const yellowPoint = 60;

    // Size mapping
    // Minimal size: 50px, Max size: 150px (at sensitivityMax)
    const size = 50 + Math.min(average / sensitivityMax, 1) * 100;

    // Color mapping
    // Green (low) -> Yellow (medium) -> Red (high)
    let r, g, b;
    if (average < yellowPoint) {
        // Green to Yellow
        r = Math.floor((average / yellowPoint) * 255);
        g = 255;
        b = 0;
    } else {
        // Yellow to Red
        // Clamp average to sensitivityMax for color calculation
        const clampedAvg = Math.min(average, sensitivityMax);
        const range = sensitivityMax - yellowPoint;
        const progress = (clampedAvg - yellowPoint) / range;

        r = 255;
        g = Math.floor(255 - (progress * 255));
        b = 0;
    }

    meterCircle.style.width = `${size}px`;
    meterCircle.style.height = `${size}px`;
    meterCircle.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 0.6)`;
    meterCircle.style.boxShadow = `0 0 ${20 + (average / 3)}px rgba(${r}, ${g}, ${b}, 0.5)`;

    requestAnimationFrame(updateMeter);
}

micSelect.addEventListener('change', (e) => {
    startListening(e.target.value);
    hideControls(500); // Fade out shortly after selection
});

// Initialize
getMicrophones().then(() => {
    startListening();
});
