# Deployment Instructions

## 1. GitHub Repository
The repository has been initialized in the root `sound_meter` directory.
To push to GitHub:
1.  Create a new repository on GitHub named `sound_meter`.
2.  Run the following commands in your terminal:
    ```bash
    git remote add origin https://github.com/benjscohen/sound_meter.git
    git branch -M main
    git push -u origin main
    ```

## 2. App Release
To make the download link work:
1.  Build your Electron app (using `npm run build` in the root directory).
2.  Go to the "Releases" section of your GitHub repository.
3.  Draft a new release.
4.  Upload the `.dmg` file from the `dist` folder.
5.  Name the release `v1.0.0` (or similar) and publish it.
6.  Ensure the asset name matches `Sound.Meter.dmg` (or update the link in `landing_page/index.html`).

## 3. Landing Page Deployment
### Option A: Netlify / Vercel (Recommended)
1.  Connect your GitHub repository to Netlify or Vercel.
2.  Set the "Base directory" to `landing_page`.
3.  Set the "Build command" to `npm run build`.
4.  Set the "Publish directory" to `dist`.
5.  Deploy!

### Option B: GitHub Pages
1.  Go to your repository settings -> Pages.
2.  Select "GitHub Actions" as the source.
3.  Configure a workflow to build the `landing_page` directory and deploy the `landing_page/dist` folder.

### Option C: Manual Upload (GoDaddy)
1.  Run `npm run build` in the `landing_page` directory (already done).
2.  The output is in `landing_page/dist`.
3.  Upload the contents of `landing_page/dist` to your GoDaddy hosting file manager (usually `public_html`).
