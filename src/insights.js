// Insights window: per-day loudness history with a timeline and a
// two-week overview. All data comes from the main process over IPC.
(() => {
    const api = window.soundMeter;
    const V = window.AudioVisualizer;
    const { YELLOW_POINT_RATIO, LOUD_RATIO, ZONE_LABELS, COLORS } = V.CONSTANTS;

    const $ = (id) => document.getElementById(id);
    const MINUTE = 60 * 1000;
    const DAYS_SHOWN = 14;
    const REFRESH_MS = 20 * 1000;

    let days = [];          // Summaries, newest first
    let selected = null;    // 'YYYY-MM-DD'
    let dayData = null;     // { minutes, summary }
    let chart = null;       // Geometry of the rendered chart, for hover

    /* -------------------------------------------------------- formatting */

    const pad = (n) => String(n).padStart(2, '0');
    const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const parseKey = (key) => new Date(`${key}T00:00:00`);
    const pct = (ratio) => `${Math.round(ratio * 100)}`;
    const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const rgb = ({ r, g, b }) => `rgb(${r} ${g} ${b})`;

    function duration(seconds) {
        if (seconds < 60) return `${Math.round(seconds)}s`;
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return `${minutes}m`;
        return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
    }

    function dayName(key) {
        const today = dateKey(new Date());
        const yesterday = dateKey(new Date(Date.now() - 24 * 60 * MINUTE));
        if (key === today) return 'Today';
        if (key === yesterday) return 'Yesterday';
        return parseKey(key).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    }

    // Compact form for "vs ..." comparisons.
    function shortDayName(key) {
        const name = dayName(key);
        if (name === 'Today' || name === 'Yesterday') return name.toLowerCase();
        return parseKey(key).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    }

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    /* ----------------------------------------------------------- metrics */

    function delta(now, before, unit) {
        const diff = Math.round(now - before);
        if (!Number.isFinite(diff) || diff === 0) return '';
        const cls = diff > 0 ? 'up' : 'down';
        return `<span class="${cls}">${diff > 0 ? '+' : '−'}${Math.abs(diff)}${unit}</span>`;
    }

    function renderMetrics(summary, previous) {
        const share = summary.seconds ? summary.loudSeconds / summary.seconds : 0;
        const prevShare = previous && previous.seconds ? previous.loudSeconds / previous.seconds : null;
        const versus = previous ? `vs ${shortDayName(previous.date)}` : '';

        $('m-loud').textContent = duration(summary.loudSeconds);
        $('m-loud-note').innerHTML = prevShare === null
            ? `${Math.round(share * 100)}% of monitored time`
            : `${delta(share * 100, prevShare * 100, ' pts') || `${Math.round(share * 100)}% · same `}${escapeHtml(versus)}`;

        $('m-avg').innerHTML = `${pct(summary.avg)}<small>%</small>`;
        $('m-avg-note').innerHTML = previous
            ? `${delta(summary.avg * 100, previous.avg * 100, ' pts') || 'Same '}${escapeHtml(versus)}`
            : escapeHtml(ZONE_LABELS[V.zoneForRatio(summary.avg)]);

        $('m-peak').innerHTML = `${pct(summary.peak)}<small>%</small>`;
        $('m-peak-note').textContent = summary.peak >= 1 ? 'Above your limit' : 'Of your limit';

        $('m-time').textContent = duration(summary.seconds);
        const minutes = dayData.minutes;
        $('m-time-note').textContent = minutes.length
            ? `${time(minutes[0].t)} – ${time(minutes[minutes.length - 1].t + MINUTE)}`
            : '';
    }

    /* ------------------------------------------------------------- chart */

    function hourStep(spanHours, width) {
        const maxLabels = Math.max(2, Math.floor(width / 90));
        return [1, 2, 3, 4, 6, 12].find((step) => spanHours / step <= maxLabels) || 12;
    }

    function renderChart() {
        const svg = $('chart-svg');
        const { minutes } = dayData;
        const width = svg.clientWidth;
        const height = svg.clientHeight;
        if (!width || !height || !minutes.length) {
            svg.innerHTML = '';
            chart = null;
            return;
        }

        const m = { left: 34, right: 12, top: 12, bottom: 24 };
        const HOUR = 60 * MINUTE;
        const first = new Date(minutes[0].t);
        first.setMinutes(0, 0, 0);
        const t0 = first.getTime();
        const lastEnd = minutes[minutes.length - 1].t + MINUTE;
        const t1 = Math.max(t0 + HOUR, Math.ceil((lastEnd - t0) / HOUR) * HOUR + t0);
        const maxPeak = Math.max(...minutes.map((p) => p.peak));
        const yMax = Math.min(1.5, Math.max(1.1, maxPeak * 1.05));

        const x = (t) => m.left + ((t - t0) / (t1 - t0)) * (width - m.left - m.right);
        const y = (v) => height - m.bottom - (Math.min(v, yMax) / yMax) * (height - m.top - m.bottom);
        const mid = (p) => x(p.t + MINUTE / 2);

        // Break the line wherever monitoring stopped for more than a minute.
        const segments = [];
        for (const point of minutes) {
            const segment = segments[segments.length - 1];
            if (segment && point.t - segment[segment.length - 1].t <= 1.5 * MINUTE) segment.push(point);
            else segments.push([point]);
        }

        const line = (segment, key) => segment.length === 1
            ? `M${(mid(segment[0]) - 0.5).toFixed(1)} ${y(segment[0][key]).toFixed(1)}h1`
            : segment.map((p, i) => `${i ? 'L' : 'M'}${mid(p).toFixed(1)} ${y(p[key]).toFixed(1)}`).join('');
        const area = (segment) => segment.length === 1 ? '' :
            `${line(segment, 'avg')}L${mid(segment[segment.length - 1]).toFixed(1)} ${y(0)}L${mid(segment[0]).toFixed(1)} ${y(0)}Z`;

        const stop = (ratio, color, opacity = 1) =>
            `<stop offset="${(ratio / yMax).toFixed(3)}" stop-color="${rgb(color)}" stop-opacity="${opacity}"/>`;
        const stops = (opacity, fade) => [
            stop(0, COLORS.GREEN, fade ? 0.02 : opacity),
            stop(YELLOW_POINT_RATIO, COLORS.AMBER, opacity),
            stop(1, COLORS.RED, opacity)
        ].join('');
        const gradient = (id, body) =>
            `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${y(0)}" x2="0" y2="${y(yMax)}">${body}</linearGradient>`;

        const parts = [`<defs>${gradient('level-stroke', stops(1))}${gradient('level-fill', stops(0.22, true))}</defs>`];

        for (const value of [0, 0.5, 1]) {
            parts.push(`<line class="grid" x1="${m.left}" x2="${width - m.right}" y1="${y(value)}" y2="${y(value)}"/>`);
            parts.push(`<text x="${m.left - 8}" y="${y(value) + 4}" text-anchor="end">${value * 100}</text>`);
        }

        const span = (t1 - t0) / HOUR;
        const step = hourStep(span, width);
        for (let h = 0; h <= span; h += step) {
            const t = t0 + h * HOUR;
            const label = new Date(t).toLocaleTimeString([], { hour: 'numeric' });
            parts.push(`<text x="${x(t)}" y="${height - 6}" text-anchor="${h === 0 ? 'start' : 'middle'}">${escapeHtml(label)}</text>`);
        }

        parts.push(`<line class="threshold" x1="${m.left}" x2="${width - m.right}" y1="${y(LOUD_RATIO)}" y2="${y(LOUD_RATIO)}"/>`);
        parts.push(`<text class="threshold-label" x="${width - m.right}" y="${y(LOUD_RATIO) - 6}" text-anchor="end">Too loud</text>`);

        for (const segment of segments) {
            parts.push(`<path class="area" d="${area(segment)}"/>`);
            parts.push(`<path class="peak" d="${line(segment, 'peak')}"/>`);
            parts.push(`<path class="avg" d="${line(segment, 'avg')}"/>`);
        }

        parts.push('<line class="cursor" id="cursor" y1="' + m.top + '" y2="' + (height - m.bottom) + '" visibility="hidden"/>');
        parts.push('<circle class="dot" id="dot" r="4" visibility="hidden"/>');

        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.innerHTML = parts.join('');
        chart = { minutes, mid, y, width };
    }

    function onChartMove(event) {
        if (!chart) return;
        const bounds = $('chart-svg').getBoundingClientRect();
        const px = event.clientX - bounds.left;
        let nearest = chart.minutes[0];
        for (const point of chart.minutes) {
            if (Math.abs(chart.mid(point) - px) < Math.abs(chart.mid(nearest) - px)) nearest = point;
        }
        const cx = chart.mid(nearest);
        const cursor = $('cursor');
        const dot = $('dot');
        cursor.setAttribute('x1', cx);
        cursor.setAttribute('x2', cx);
        cursor.setAttribute('visibility', 'visible');
        dot.setAttribute('cx', cx);
        dot.setAttribute('cy', chart.y(nearest.avg));
        dot.setAttribute('visibility', 'visible');

        const tooltip = $('tooltip');
        tooltip.hidden = false;
        tooltip.innerHTML =
            `<b>${escapeHtml(time(nearest.t))}</b>` +
            `<div><span>Average</span><span>${pct(nearest.avg)}%</span></div>` +
            `<div><span>Peak</span><span>${pct(nearest.peak)}%</span></div>` +
            (nearest.loud ? `<div><span>Too loud</span><span>${nearest.loud}s</span></div>` : '');
        const flip = cx + 16 + tooltip.offsetWidth > chart.width;
        const left = flip ? cx - 16 - tooltip.offsetWidth : cx + 16;
        tooltip.style.transform = `translate(${Math.round(left)}px, 10px)`;
    }

    function onChartLeave() {
        $('tooltip').hidden = true;
        const cursor = $('cursor');
        const dot = $('dot');
        if (cursor) cursor.setAttribute('visibility', 'hidden');
        if (dot) dot.setAttribute('visibility', 'hidden');
    }

    /* --------------------------------------------------------- day strip */

    function renderDays() {
        const byDate = new Map(days.map((d) => [d.date, d]));
        const maxLoud = Math.max(60, ...days.map((d) => d.loudSeconds));
        const buttons = [];

        for (let i = DAYS_SHOWN - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const key = dateKey(date);
            const summary = byDate.get(key);

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'day';
            button.setAttribute('role', 'option');
            button.setAttribute('aria-selected', String(key === selected));
            button.disabled = !summary;
            button.title = summary
                ? `${dayName(key)}: ${duration(summary.loudSeconds)} too loud of ${duration(summary.seconds)} monitored`
                : `${dayName(key)}: no data`;

            const count = document.createElement('span');
            count.className = 'count';
            count.textContent = summary ? `${Math.round(summary.loudSeconds / 60)}m` : '';

            const track = document.createElement('span');
            track.className = 'track';
            const bar = document.createElement('span');
            bar.className = 'bar';
            if (summary) {
                const share = summary.seconds ? summary.loudSeconds / summary.seconds : 0;
                if (share > 0.15) bar.classList.add('lots');
                else if (share > 0.05) bar.classList.add('some');
                bar.style.height = `${Math.max(4, (summary.loudSeconds / maxLoud) * 100)}%`;
            }
            track.append(bar);

            const label = document.createElement('span');
            label.className = 'label';
            label.textContent = i === 0 ? 'Today' : date.toLocaleDateString([], { weekday: 'short', day: 'numeric' });

            button.append(count, track, label);
            button.addEventListener('click', () => select(key));
            buttons.push(button);
        }

        $('days').replaceChildren(...buttons);
    }

    /* -------------------------------------------------------------- data */

    async function select(date) {
        selected = date;
        dayData = await api.getDay(date);
        if (!dayData) return;

        const index = days.findIndex((d) => d.date === date);
        const previous = index >= 0 ? days[index + 1] : null;
        const { summary } = dayData;

        $('subtitle').textContent = parseKey(date).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        $('chart-title').textContent = dayName(date);
        $('chart-sub').textContent = summary.loudSeconds > 0 && summary.loudestAt
            ? `Loudest around ${time(summary.loudestAt)}.`
            : 'No loud moments. Nicely done.';

        renderMetrics(summary, previous);
        renderChart();
        renderDays();
        onChartLeave();
    }

    async function load() {
        days = await api.listDays(DAYS_SHOWN + 1);
        const hasData = days.length > 0;
        $('empty').hidden = hasData;
        $('content').hidden = !hasData;
        $('export').disabled = !hasData;
        $('clear').disabled = !hasData;
        if (!hasData) {
            $('subtitle').textContent = 'How your day sounded';
            return;
        }
        if (!selected || !days.some((d) => d.date === selected)) selected = days[0].date;
        await select(selected);
    }

    /* -------------------------------------------------------------- live */

    let liveTimer = null;

    function onSample(sample) {
        const live = $('live');
        const zone = V.zoneForRatio(sample.avg);
        const { r, g, b } = V.colorForRatio(Math.min(sample.avg, 1));
        live.hidden = false;
        live.querySelector('i').style.setProperty('--c', `${r} ${g} ${b}`);
        $('live-text').textContent = `Now · ${ZONE_LABELS[zone]}`;
        clearTimeout(liveTimer);
        liveTimer = setTimeout(() => { live.hidden = true; }, 3000);
    }

    /* -------------------------------------------------------------- boot */

    $('export').addEventListener('click', () => api.exportHistory());
    $('clear').addEventListener('click', async () => {
        if (await api.clearHistory()) {
            selected = null;
            load();
        }
    });
    $('chart-svg').addEventListener('mousemove', onChartMove);
    $('chart-svg').addEventListener('mouseleave', onChartLeave);
    new ResizeObserver(() => { if (dayData) renderChart(); }).observe($('chart'));

    api.onSample(onSample);
    setInterval(() => {
        if (document.visibilityState === 'visible') load();
    }, REFRESH_MS);
    window.addEventListener('focus', load);

    load();
})();
