// A shared week, as carried by a share link. Everything lives in the URL
// (shhh.it.com/s?c=93&l=4200&...), so nothing is stored on a server, and
// every field is a bounded number, so a link can't smuggle in text.
//
// The app builds these links in src/main/share.js; scripts/check-site.mjs
// keeps the two sides in agreement.
//
//   c  calm share of the week, percent        l  seconds too loud
//   m  seconds monitored                      s  calm streak, days
//   a  average level, percent of limit        d  loudest weekday (0 = Monday)
//   h  loudest hour (0-23)

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK = 7 * 24 * 60 * 60;

const GREEN = [48, 209, 88];
const AMBER = [255, 204, 0];
const RED = [255, 69, 58];
const YELLOW_POINT = 60 / 140;

function int(value, min, max) {
    if (typeof value !== 'string' || !/^\d{1,7}$/.test(value)) return null;
    const number = Number(value);
    return number >= min && number <= max ? number : null;
}

/** Reads stats from URLSearchParams; null unless the link is well formed. */
export function parseStats(params) {
    const calm = int(params.get('c'), 0, 100);
    const monitored = int(params.get('m'), 1, WEEK);
    const loud = int(params.get('l'), 0, WEEK);
    if (calm === null || monitored === null || loud === null || loud > monitored) return null;
    return {
        calm,
        loud,
        monitored,
        streak: int(params.get('s'), 0, 999) ?? 0,
        avg: int(params.get('a'), 0, 150) ?? 0,
        dow: int(params.get('d'), 0, 6),
        hour: int(params.get('h'), 0, 23)
    };
}

/** The canonical query string for a set of stats. */
export function toQuery(stats) {
    const params = new URLSearchParams({
        c: stats.calm, l: stats.loud, m: stats.monitored, s: stats.streak, a: stats.avg
    });
    if (stats.dow !== null && stats.hour !== null) {
        params.set('d', stats.dow);
        params.set('h', stats.hour);
    }
    return params.toString();
}

export function duration(seconds) {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.floor(minutes / 60)}h`;
}

const hourLabel = (hour) => `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;

/** The words on the card and the share page. */
export function describe(stats) {
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

/** Orb colour: green for a calm week, warming as a quarter of it gets loud. */
export function colour(stats) {
    const ratio = Math.min(((100 - stats.calm) / 100) * 4, 1);
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return ratio < YELLOW_POINT
        ? mix(GREEN, AMBER, ratio / YELLOW_POINT)
        : mix(AMBER, RED, (ratio - YELLOW_POINT) / (1 - YELLOW_POINT));
}
