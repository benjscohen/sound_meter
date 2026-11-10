// Draws the shareable "my week" card onto a canvas. It mirrors the preview
// image the website renders for share links (landing_page/api/og.js). The
// words and numbers come from the main process (src/main/share.js).
(() => {
    const V = window.AudioVisualizer;
    const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif';
    const INK = '#0a2540';
    const MUTED = '#5b6b7f';

    const rgba = ({ r, g, b }, alpha) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

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

    /** `card` is { headline, line, stats: [[label, value]], loudShare }. */
    function draw(canvas, card) {
        const ctx = canvas.getContext('2d');
        const { width, height } = canvas;
        // Green for a calm week, warming as a quarter of it gets loud.
        const colour = V.colorForRatio(Math.min(card.loudShare * 4, 1));
        const [number, word] = card.headline.split(' ');

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, width, height);
        glow(ctx, 980, 290, 520, rgba(colour, 0.26));
        glow(ctx, 1200, 630, 420, 'rgba(255, 204, 0, 0.16)');
        glow(ctx, 0, 0, 380, 'rgba(48, 209, 88, 0.10)');

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
        text(ctx, 'Shhh.it', 128, 99, `700 30px ${FONT}`, INK);
        text(ctx, 'My week in volume', 84, 190, `600 30px ${FONT}`, MUTED);

        const big = text(ctx, number, 80, 330, `800 150px ${FONT}`, INK);
        text(ctx, word, 80 + big + 22, 330, `700 64px ${FONT}`, INK);
        text(ctx, card.line, 84, 392, `500 30px ${FONT}`, MUTED);

        let x = 84;
        for (const [label, value] of card.stats) {
            text(ctx, label, x, 478, `500 22px ${FONT}`, MUTED);
            const used = text(ctx, value, x, 522, `700 36px ${FONT}`, INK);
            x += Math.max(used, 150) + 56;
        }

        text(ctx, 'Know when you’re getting loud  ·  shhh.it.com', 84, 584, `500 22px ${FONT}`, MUTED);
    }

    window.ShareCard = { draw };
})();
