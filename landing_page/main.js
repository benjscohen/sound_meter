// Main JS file
console.log('Sound Meter Landing Page Loaded');

async function updateDownloadLinks() {
    const repo = 'benjscohen/sound_meter';
    const latestUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    const allReleasesUrl = `https://api.github.com/repos/${repo}/releases`;

    try {
        // Fetch Latest Release for Download Link
        const latestResponse = await fetch(latestUrl);
        if (latestResponse.ok) {
            const data = await latestResponse.json();
            const version = data.tag_name;
            const dmgAsset = data.assets.find(asset => asset.name.endsWith('.dmg'));

            if (dmgAsset) {
                const downloadUrl = dmgAsset.browser_download_url;

                const heroBtn = document.getElementById('download-btn');
                if (heroBtn) heroBtn.href = downloadUrl;

                const navBtn = document.getElementById('nav-download-btn');
                if (navBtn) navBtn.href = downloadUrl;

                const versionText = document.getElementById('version-text');
                if (versionText) versionText.textContent = `${version} • macOS 13+`;
            }
        }

        // Fetch All Releases for Total Download Count
        const allResponse = await fetch(allReleasesUrl);
        if (allResponse.ok) {
            const releases = await allResponse.json();
            let totalDownloads = 0;

            releases.forEach(release => {
                release.assets.forEach(asset => {
                    totalDownloads += asset.download_count;
                });
            });

            const downloadCountText = document.getElementById('download-count');
            if (downloadCountText && totalDownloads > 0) {
                downloadCountText.textContent = `${totalDownloads.toLocaleString()} Downloads`;
            }
        }

    } catch (error) {
        console.error('Error fetching release data:', error);
    }
}

document.addEventListener('DOMContentLoaded', updateDownloadLinks);
