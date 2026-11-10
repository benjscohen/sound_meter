const { prepareShare, shareStats, shareUrl, describe: words, caption, destinationUrl, DESTINATIONS } = require('./share');

const trends = (overrides = {}) => ({
    week: {
        current: { seconds: 61560, loudSeconds: 4200, avg: 0.376, share: 0.068 },
        streak: 3,
        ...overrides.week
    },
    heatmap: { loudest: { dow: 4, hour: 15, avg: 0.6 }, ...overrides.heatmap },
    // Things that must never leak into a share:
    meetings: [{ label: 'Secret project sync' }],
    people: [{ label: 'Dana Kim' }]
});

describe('shareStats', () => {
    test('boils trends down to bounded numbers', () => {
        expect(shareStats(trends())).toEqual({ calm: 93, loud: 4200, monitored: 61560, streak: 3, avg: 38, dow: 4, hour: 15 });
    });

    test('copes with no loudest slot and caps runaway averages', () => {
        const stats = shareStats(trends({ heatmap: { loudest: null }, week: { current: { seconds: 600, loudSeconds: 600, avg: 9, share: 1 } } }));
        expect(stats).toMatchObject({ calm: 0, avg: 150, dow: null, hour: null });
    });

    test('is null until there is something worth sharing', () => {
        expect(shareStats(null)).toBeNull();
        expect(shareStats({ week: { current: null, streak: 0 } })).toBeNull();
        expect(shareStats(trends({ week: { current: { seconds: 20, loudSeconds: 0, avg: 0.1, share: 0 } } }))).toBeNull();
    });
});

describe('links and words', () => {
    const stats = shareStats(trends());

    test('the link carries every number and nothing else', () => {
        expect(shareUrl(stats)).toBe('https://shhh.it.com/s?c=93&l=4200&m=61560&s=3&a=38&d=4&h=15');
        expect(shareUrl({ ...stats, dow: null, hour: null })).toBe('https://shhh.it.com/s?c=93&l=4200&m=61560&s=3&a=38');
    });

    test('describe words the card', () => {
        expect(words(stats)).toEqual({
            headline: '93% calm',
            line: 'Too loud for 1h 10m of 17h 6m this week',
            stats: [['Calm streak', '3 days'], ['Average level', '38%'], ['Loudest time', 'Fri 3 PM']]
        });
    });

    test('a short streak gives way to loud time; midnight and noon read naturally', () => {
        expect(words({ ...stats, streak: 1 }).stats[0]).toEqual(['Loud time', '1h 10m']);
        expect(words({ ...stats, hour: 0 }).stats[2][1]).toBe('Fri 12 AM');
        expect(words({ ...stats, hour: 12 }).stats[2][1]).toBe('Fri 12 PM');
        expect(words({ ...stats, dow: null, hour: null }).stats[2][1]).toBe('—');
    });

    test('caption is short and unpushy', () => {
        expect(caption(stats)).toBe('My week in volume: 93% calm. Tracked with Sound Meter.');
    });
});

describe('destinations', () => {
    const stats = shareStats(trends());
    const link = shareUrl(stats);

    test('every destination opens a known compose page containing the link', () => {
        const hosts = { x: 'x.com', linkedin: 'www.linkedin.com', threads: 'www.threads.net', bluesky: 'bsky.app', whatsapp: 'wa.me' };
        for (const { key } of DESTINATIONS) {
            const url = destinationUrl(key, stats);
            expect(decodeURIComponent(url.replace(/\+/g, ' '))).toContain(link);
            if (key === 'email') expect(url.startsWith('mailto:?subject=')).toBe(true);
            else expect(new URL(url).host).toBe(hosts[key]);
        }
    });

    test('unknown destinations go nowhere', () => {
        expect(destinationUrl('evil', stats)).toBeNull();
        expect(destinationUrl('__proto__', stats)).toBeNull();
    });
});

describe('prepareShare', () => {
    test('bundles what the dialog needs, with no calendar details anywhere', () => {
        const share = prepareShare(trends());
        expect(share.displayUrl).toBe('shhh.it.com/s?c=93&l=4200&m=61560&s=3&a=38&d=4&h=15');
        expect(share.card.loudShare).toBeCloseTo(0.07);
        expect(share.destinations.map((d) => d.label)).toEqual(['X', 'LinkedIn', 'Threads', 'Bluesky', 'WhatsApp', 'Email']);
        expect(share.destinations[0]).not.toHaveProperty('url');
        expect(JSON.stringify(share)).not.toMatch(/Secret|Dana/);
    });

    test('is null with nothing to share', () => {
        expect(prepareShare({ week: { current: null } })).toBeNull();
    });
});
