// Script for the simple text pages (changelog, privacy).
import { inject } from '@vercel/analytics';
import { REPO, revealForVersion } from './release.js';

inject();
document.getElementById('year').textContent = new Date().getFullYear();

// Changelog entries for a version appear once that version is released.
if (document.querySelector('[data-min-version]')) {
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
        .then((response) => (response.ok ? response.json() : null))
        .then((release) => release && revealForVersion(release.tag_name.replace(/^v/, '')))
        .catch(() => {});
}
