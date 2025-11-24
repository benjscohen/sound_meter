// Main JS file
console.log('Sound Meter Landing Page Loaded');

async function updateDownloadLinks() {
    const repo = 'benjscohen/sound_meter';
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Network response was not ok');

        const data = await response.json();
        const version = data.tag_name;

        // Find the DMG asset
        const dmgAsset = data.assets.find(asset => asset.name.endsWith('.dmg'));

        if (dmgAsset) {
            const downloadUrl = dmgAsset.browser_download_url;

            // Update Hero Button
            const heroBtn = document.getElementById('download-btn');
            if (heroBtn) {
                heroBtn.href = downloadUrl;
            }

            // Update Nav Button
            const navBtn = document.getElementById('nav-download-btn');
            if (navBtn) {
                navBtn.href = downloadUrl;
            }

            // Update Version Text
            const versionText = document.getElementById('version-text');
            if (versionText) {
                versionText.textContent = `${version} • macOS 13+`;
            }
        }
    } catch (error) {
        console.error('Error fetching latest release:', error);
        // Fallback links are already in HTML (pointing to /releases/latest)
    }
}

document.addEventListener('DOMContentLoaded', updateDownloadLinks);
