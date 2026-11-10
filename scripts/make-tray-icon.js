// Generates the menu-bar (tray) template icon: an orb inside a thin ring.
// Pure Node, no dependencies. Run with: node scripts/make-tray-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buffer) {
    let crc = ~0;
    for (const byte of buffer) {
        crc ^= byte;
        for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return ~crc >>> 0;
}

function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

// Template images are black + alpha; macOS recolours them for the menu bar.
function png(size, alphaAt) {
    const raw = Buffer.alloc(size * (1 + size * 4));
    for (let y = 0; y < size; y++) {
        const row = y * (1 + size * 4);
        raw[row] = 0; // No filter
        for (let x = 0; x < size; x++) {
            raw[row + 1 + x * 4 + 3] = Math.round(alphaAt(x, y) * 255);
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;  // Bit depth
    header[9] = 6;  // RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

function icon(size) {
    const unit = size / 18;
    const centre = size / 2;
    const orb = 4.1 * unit;
    const ringOuter = 7.6 * unit;
    const ringInner = 6.3 * unit;
    const SAMPLES = 4;

    return png(size, (px, py) => {
        let hits = 0;
        for (let sy = 0; sy < SAMPLES; sy++) {
            for (let sx = 0; sx < SAMPLES; sx++) {
                const x = px + (sx + 0.5) / SAMPLES - centre;
                const y = py + (sy + 0.5) / SAMPLES - centre;
                const d = Math.hypot(x, y);
                if (d <= orb || (d >= ringInner && d <= ringOuter)) hits++;
            }
        }
        return hits / (SAMPLES * SAMPLES);
    });
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'trayTemplate.png'), icon(18));
fs.writeFileSync(path.join(out, 'trayTemplate@2x.png'), icon(36));
console.log('Wrote assets/trayTemplate.png and assets/trayTemplate@2x.png');
