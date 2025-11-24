# Sound Meter

A minimalist macOS desktop application that displays real-time sound decibel levels.

## Features

- 🎤 Real-time audio level monitoring
- 🎨 Visual feedback with color changes based on sound intensity
- 🖥️ Floats above all windows
- 📊 Decibel (dB) display

## Installation

Download the latest release from the [Releases](https://github.com/benjscohen/sound_meter/releases) page.

### macOS Security Note

If you see a message saying **"Sound Meter" is damaged and can't be opened**, follow the steps in [INSTALL.md](INSTALL.md).

## Development

```bash
# Install dependencies
npm install

# Run the app
npm start
```

## Building

Builds are automated via GitHub Actions. Each commit to the main branch triggers a build that produces a signed and notarized DMG.

## License

MIT
