# Sound Meter

A beautiful, minimalist macOS desktop application that helps you monitor your voice volume in real-time. It floats on top of your other windows, providing subtle visual feedback when you're getting too loud.

## Features

- **🎤 Real-time Monitoring:** Instantly visualizes your microphone input level.
- **🎨 Visual Feedback:** The circle grows and changes color (Green → Yellow → Red) as volume increases.
- **⚙️ Adjustable Sensitivity:** Choose from High, Medium, or Low sensitivity to suit your environment.
- **🖥️ Always on Top:** Floats above all other windows so you never lose track of it during calls.
- **🔒 Privacy First:** Runs 100% locally. No audio is ever recorded, stored, or transmitted.
- **🔄 Auto-Updates:** Automatically checks for and installs the latest version.
- **📈 Live Stats:** Website displays real-time download counts from GitHub.

## Installation

Download the latest version for macOS (13+) from the [Releases Page](https://github.com/benjscohen/sound_meter/releases/latest).

## Development

### Prerequisites

- Node.js (v18+)
- npm

### Setup

```bash
# Clone the repository
git clone https://github.com/benjscohen/sound_meter.git

# Install dependencies
npm install
```

### Running Locally

```bash
npm start
```

### Testing

Run the unit test suite:

```bash
npm test
```

## Website / Landing Page

The `landing_page/` directory contains the source code for the product website (e.g., `shhh.it.com`).

- **Live Download Count:** The site fetches data from the GitHub API to display the total number of downloads across all releases in real-time.
- **Dynamic Links:** Download buttons automatically point to the latest available release artifact.

## Build & Release

This project uses **GitHub Actions** for a fully automated CI/CD pipeline.

- **Push to main:** Triggers a build check.
- **Push a tag (e.g., `v1.0.0`):** Triggers the full release pipeline:
    1.  Runs unit tests.
    2.  Builds the application.
    3.  Signs the code with an Apple Developer ID.
    4.  Notarizes the app with Apple.
    5.  Publishes a new Release to GitHub with the signed `.dmg` and auto-update artifacts.

### Secrets

To build and sign the app locally or in a fork, you will need valid Apple Developer credentials. See `SETUP_SECRETS.md` (if available) or check `electron-builder` documentation for required environment variables (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`).

## License

MIT
