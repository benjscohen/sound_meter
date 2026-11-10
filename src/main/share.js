// Sharing a week: turns Insights totals into a card, a link and ready-made
// posts. Only totals are ever shared - nothing from the calendar.
//
// The link carries the numbers in its query string and is rendered by the
// website (landing_page/api/_stats.js mirrors the format and wording here;
// scripts/check-share.mjs keeps the two in step).

const SITE = 'https://shhh.it.com';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function duration(seconds) {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.floor(minutes / 60)}h`;
}

const hourLabel = (hour) => `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;

/** The handful of numbers a share contains, from trend insights. */
function shareStats(trends) {
    const week = (trends && trends.week && trends.week.current) || null;
    if (!week || !(week.seconds >= 60)) return null;
    const loudest = trends.heatmap && trends.heatmap.loudest;
    return {
        calm: Math.round((1 - week.share) * 100),
        loud: Math.round(week.loudSeconds),
        monitored: Math.round(week.seconds),
        streak: trends.week.streak || 0,
        avg: Math.min(150, Math.round(week.avg * 100)),
        dow: loudest ? loudest.dow : null,
        hour: loudest ? loudest.hour : null
    };
}

function shareQuery(stats) {
    const params = new URLSearchParams({
        c: stats.calm, l: stats.loud, m: stats.monitored, s: stats.streak, a: stats.avg
    });
    if (stats.dow !== null && stats.hour !== null) {
        params.set('d', stats.dow);
        params.set('h', stats.hour);
    }
    return params.toString();
}

const shareUrl = (stats) => `${SITE}/s?${shareQuery(stats)}`;

/** The words on the card. */
function describe(stats) {
    return {
        headline: `${stats.calm}% calm`,
        line: `Too loud for ${duration(stats.loud)} of ${duration(stats.monitored)} this week`,
        stats: [
            stats.streak >= 2 ? ['Calm streak', `${stats.streak} days`] : ['Loud time', duration(stats.loud)],
            ['Average level', `${stats.avg}%`],
            ['Loudest time', stats.dow !== null && stats.hour !== null ? `${WEEKDAYS[stats.dow]} ${hourLabel(stats.hour)}` : '—']
        ]
    };
}

const caption = (stats) => `My week in volume: ${stats.calm}% calm. Tracked with Sound Meter.`;

// Places a share can go with one click. Each opens that service's own
// compose screen in the browser, pre-filled; nothing is posted for you.
const DESTINATIONS = [
    { key: 'x', label: 'X', url: (text, link) => `https://x.com/intent/post?${new URLSearchParams({ text, url: link })}` },
    { key: 'linkedin', label: 'LinkedIn', url: (text, link) => `https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url: link })}` },
    { key: 'threads', label: 'Threads', url: (text, link) => `https://www.threads.net/intent/post?${new URLSearchParams({ text: `${text} ${link}` })}` },
    { key: 'bluesky', label: 'Bluesky', url: (text, link) => `https://bsky.app/intent/compose?${new URLSearchParams({ text: `${text} ${link}` })}` },
    { key: 'whatsapp', label: 'WhatsApp', url: (text, link) => `https://wa.me/?${new URLSearchParams({ text: `${text} ${link}` })}` },
    {
        key: 'email',
        label: 'Email',
        url: (text, link) => `mailto:?subject=${encodeURIComponent('My week in volume')}&body=${encodeURIComponent(`${text}\n\n${link}`)}`
    }
];

function destinationUrl(key, stats) {
    const destination = DESTINATIONS.find((d) => d.key === key);
    return destination ? destination.url(caption(stats), shareUrl(stats)) : null;
}

/** Everything the share dialog needs, or null when there's nothing to share yet. */
function prepareShare(trends) {
    const stats = shareStats(trends);
    if (!stats) return null;
    const url = shareUrl(stats);
    return {
        stats,
        url,
        displayUrl: url.replace(/^https:\/\//, ''),
        caption: caption(stats),
        card: { ...describe(stats), loudShare: 1 - stats.calm / 100 },
        destinations: DESTINATIONS.map(({ key, label }) => ({ key, label }))
    };
}

module.exports = { prepareShare, shareStats, shareQuery, shareUrl, describe, caption, destinationUrl, DESTINATIONS, SITE };
