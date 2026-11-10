# Sound Meter

A beautiful, minimalist macOS desktop application that helps you monitor your voice volume in real-time. It floats on top of your other windows, providing subtle visual feedback when you're getting too loud.

## Features

- **Glanceable feedback:** a floating orb that grows and shifts green → amber → red as you get louder. Three sizes, three opacities, and optional level symbols for when colour alone is hard to read.
- **Automatic sensitivity:** learns your normal speaking level from less than a minute of talking, once, then leaves it alone. Presets and “Relearn My Voice” are in the menu.
- **Listen only during calls:** hides the orb and releases the microphone unless another app is using it, with a short grace period so muting doesn't make it blink away.
- **Notifications, both opt-in:** a quiet nudge after sustained loudness, and a weekly note that your week is ready (never during a call), which opens your share card.
- **Always on top:** stays above every window, including full-screen calls. Clicks pass through the empty space around it.
- **Click for everything:** click the orb (or the menu-bar icon) to switch microphone, change sensitivity, pause, or open Insights. Drag it anywhere; it remembers where you put it.
- **Guided first run:** a short welcome flow handles microphone permission and calibrates sensitivity to your voice.
- **Insights:** a private, per-minute history of how loud you were. *Day* shows a timeline with a breakdown by meeting and by call app; *Trends* shows the last four weeks: a weekday/hour heatmap, a calm streak, and your loudest meetings, people and apps. Export to CSV or delete any time.
- **Calendar (opt-in):** reads events from the macOS Calendar app to attribute loudness to meetings and people. Events are read on demand and never stored.
- **Call detection:** notices which app is using the microphone (Zoom, Teams, FaceTime, a browser…) so each minute can be credited to it. Needs macOS 14.2 or later.
- **Share:** a card of your week's totals plus a link (`shhh.it.com/s?…`) that shows the same card wherever it's pasted. Copy the link or image, post to X, LinkedIn, Threads, Bluesky, WhatsApp or email in one click, or use the macOS share sheet. The numbers travel in the link itself; nothing is stored online, and no meeting names or people are included.
- **Privacy first:** runs 100% locally. Only loudness numbers are stored; audio is never recorded or transmitted.
- **Auto-updates:** checks for new versions in the background.

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

```bash
npm test         # unit tests (meter maths, history store, settings)
npm run demo          # re-renders the website film from the smoke-test screenshots (needs ffmpeg)
npm run check:site    # the website's logic: share links, share page, preview image, download picking
npm run smoke    # boots the real app with a fake microphone, walks through
                 # onboarding, the meter and Insights, and saves screenshots to ./shots
```

### Project layout

- `main.js` — main process: windows, menus, tray, updates, IPC
- `src/preload.js` — the only bridge between windows and the main process
- `src/index.html` + `renderer.js` — the floating meter
- `src/onboarding.*`, `src/insights.*` — welcome flow and history window
- `src/main/` — settings and history stores (plain JSON files in the app's user-data folder), `analytics.js` (pure functions behind every Insights number) and `native.js` (bridge to the helper)
- `native/sm-helper.swift` — small Swift binary for the two things Electron can't do: read the calendar (EventKit) and list apps using the microphone (CoreAudio). Build it with `npm run build:helper`; without it the app runs with those features hidden
- `scripts/` — smoke test, asset generation (`npm run assets`), signing helpers

## Website / Landing Page

The `landing_page/` directory contains the source code for the product website (e.g., `shhh.it.com`).

- **Live Download Count:** The site fetches data from the GitHub API to display the total number of downloads across all releases in real-time.
- **Dynamic Links:** Download buttons automatically point to the latest available release artifact.
- **Pages:** `/changelog` and `/privacy` are plain HTML pages built by Vite; changelog entries for a version appear once that version is released.
- **Share pages:** `/s?…` (served by `landing_page/api/share.js`) shows a shared week, and `/api/og` renders its link-preview image. Both are stateless: every number comes from the query string and is range-checked.

## Build & Release

This project uses **GitHub Actions** for a fully automated CI/CD pipeline.

- **Push to main / pull request:** Runs unit tests and builds the landing page.
- **Push a tag (e.g., `v1.0.0`):** Triggers the full release pipeline:
    1.  Runs unit tests.
    2.  Builds the application.
    3.  Signs the code with an Apple Developer ID.
    4.  Notarizes the app with Apple.
    5.  Publishes a new Release to GitHub with signed `.dmg` installers for Apple silicon (`-arm64`) and Intel (`-x64`), plus auto-update artifacts.

### Secrets

To build and sign the app locally or in a fork, you will need valid Apple Developer credentials. See `SETUP_SECRETS.md` (if available) or check `electron-builder` documentation for required environment variables (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`).

## License

MIT
