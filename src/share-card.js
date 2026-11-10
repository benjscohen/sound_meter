// Draws the shareable "my week" card onto a canvas. Deliberately limited to
// totals: nothing from the calendar ever appears on it.
(() => {
    const V = window.AudioVisualizer;
    const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif';
    const INK = '#0a2540';
    const MUTED = '#5b6b7f';

    const rgba = ({ r, g, b }, alpha) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

    function duration(seconds) {
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return `${minutes}m`;
        return minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.floor(minutes / 60)}h`;
    }

    function hourLabel(hour) {
        return new Date(2020, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' });
    }

    function glow(ctx, x, y, radius, colour) {
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, colour);
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    function orb(ctx, x, y, radius, colour) {
        glow(ctx, x, y, radius * 2.1, rgba(colour, 0.45));
        const body = ctx.createRadialGradient(x, y + radius * 0.1, 0, x, y, radius);
        body.addColorStop(0, rgba(colour, 0.98));
        body.addColorStop(1, rgba(colour, 0.8));
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        const shine = ctx.createRadialGradient(x - radius * 0.36, y - radius * 0.44, 0, x - radius * 0.36, y - radius * 0.44, radius * 0.95);
        shine.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
        shine.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = shine;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }

    function text(ctx, value, x, y, font, colour) {
        ctx.font = font;
        ctx.fillStyle = colour;
        ctx.fillText(value, x, y);
        return ctx.measureText(value).width;
    }

    /** The figures on the card, separated from drawing so they can be checked. */
    function summarize(trends) {
        const week = (trends.week && trends.week.current) || { seconds: 0, loudSeconds: 0, avg: 0, share: 0 };
        const streak = (trends.week && trends.week.streak) || 0;
        const loudest = trends.heatmap && trends.heatmap.loudest;
        return {
            calm: Math.round((1 - week.share) * 100),
            share: week.share,
            line: `Too loud for ${duration(week.loudSeconds)} of ${duration(week.seconds)} this week`,
            stats: [
                ['Calm streak', `${streak} ${streak === 1 ? 'day' : 'days'}`],
                ['Average level', `${Math.round(week.avg * 100)}%`],
                ['Loudest time', loudest ? `${WEEKDAYS[loudest.dow]} ${hourLabel(loudest.hour)}` : '—']
            ]
        };
    }

    function draw(canvas, trends) {
        const ctx = canvas.getContext('2d');
        const { width, height } = canvas;
        const card = summarize(trends);
        // Green for a calm week, warming up as a quarter of it gets loud.
        const colour = V.colorForRatio(Math.min(card.share * 4, 1));

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, width, height);
        glow(ctx, 980, 290, 520, rgba(colour, 0.26));
        glow(ctx, 1200, 630, 420, 'rgba(255, 204, 0, 0.16)');
        glow(ctx, 0, 0, 380, 'rgba(48, 209, 88, 0.10)');

        // Rings and orb, coloured by how the week went.
        ctx.lineWidth = 2;
        [150, 210, 270].forEach((radius, i) => {
            ctx.strokeStyle = rgba(colour, 0.3 - i * 0.09);
            ctx.beginPath();
            ctx.arc(980, 290, radius, 0, Math.PI * 2);
            ctx.stroke();
        });
        orb(ctx, 980, 290, 92, colour);

        ctx.textBaseline = 'alphabetic';
        orb(ctx, 99, 88, 15, V.CONSTANTS.COLORS.GREEN);
        text(ctx, 'Shhh.it', 128, 99, `650 30px ${FONT}`, INK);
        text(ctx, 'My week in volume', 84, 190, `600 30px ${FONT}`, MUTED);

        const big = text(ctx, `${card.calm}%`, 80, 330, `800 150px ${FONT}`, INK);
        text(ctx, 'calm', 80 + big + 22, 330, `700 64px ${FONT}`, INK);
        text(ctx, card.line, 84, 392, `500 30px ${FONT}`, MUTED);

        let x = 84;
        for (const [label, value] of card.stats) {
            text(ctx, label, x, 478, `500 22px ${FONT}`, MUTED);
            const used = text(ctx, value, x, 522, `700 36px ${FONT}`, INK);
            x += Math.max(used, 150) + 56;
        }

        text(ctx, 'Know when you’re getting loud  ·  shhh.it.com', 84, 584, `500 22px ${FONT}`, MUTED);
    }

    window.ShareCard = { draw, summarize };
})();
