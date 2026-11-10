// Insights window. "Day" shows one day in detail; "Trends" shows patterns
// across the last few weeks. All numbers are computed in the main process
// (src/main/analytics.js); this file only draws them.
(() => {
    const api = window.soundMeter;
    const V = window.AudioVisualizer;
    const { YELLOW_POINT_RATIO, LOUD_RATIO, ZONE_LABELS, COLORS } = V.CONSTANTS;

    const $ = (id) => document.getElementById(id);
    const MINUTE = 60 * 1000;
    const DAYS_SHOWN = 14;
    const REFRESH_MS = 20 * 1000;
    const MAX_ROWS = 6;
    const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    let view = 'day';
    let days = [];          // Day summaries, newest first
    let selected = null;    // 'YYYY-MM-DD'
    let dayData = null;     // Result of api.getDay
    let chart = null;       // Geometry of the rendered chart, for hover

    /* -------------------------------------------------------- formatting */

    const pad = (n) => String(n).padStart(2, '0');
    const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const parseKey = (key) => new Date(`${key}T00:00:00`);
    const pct = (ratio) => `${Math.round(ratio * 100)}`;
    const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const hourLabel = (hour) => new Date(2020, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' });
    const rgb = ({ r, g, b }, alpha = 1) => (alpha === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha.toFixed(2)})`);
    const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

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

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    /* ------------------------------------------------- shared components */

    // A change badge. For loudness, down is good (green) and up is bad (red).
    function delta(now, before, unit) {
        const diff = Math.round(now - before);
        if (!Number.isFinite(diff) || diff === 0) return '';
        return `<span class="${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '+' : '−'}${Math.abs(diff)}${unit}</span>`;
    }

    /** Fills a metrics row. `items` are { label, value, unit, note } (note may contain markup). */
    function renderMetrics(container, items) {
        container.innerHTML = items.map((item) => `
            <article class="card metric">
                <h3>${escapeHtml(item.label)}</h3>
                <p class="value">${escapeHtml(item.value)}${item.unit ? `<small>${escapeHtml(item.unit)}</small>` : ''}</p>
                <p class="note">${item.note || ''}</p>
            </article>`).join('');
    }

    function panelHead(title, sub) {
        const head = el('div', 'panel-head');
        const text = el('div');
        text.append(el('h2', '', title), el('p', 'sub', sub));
        head.append(text);
        return head;
    }

    /**
     * A ranked list card: label, detail line, a level bar and the share of
     * time spent too loud. Used for meetings, people and apps alike.
     */
    function renderList(card, { title, sub, rows, empty, detail }) {
        card.hidden = false;
        const list = el('div', 'rows');
        for (const row of rows.slice(0, MAX_ROWS)) {
            const item = el('div', 'row');
            const text = el('div', 'row-text');
            text.append(el('span', 'row-label', row.label), el('span', 'row-sub', detail(row)));

            const bar = el('div', 'row-bar');
            const fill = el('i');
            fill.style.width = `${Math.max(3, Math.min(row.avg, 1) * 100)}%`;
            fill.style.background = rgb(V.colorForRatio(Math.min(row.avg, 1)));
            bar.append(fill);
            bar.title = `Average level ${pct(row.avg)}% of your limit`;

            const value = el('span', 'row-value', `${pct(row.share)}%`);
            value.append(el('small', '', ' loud'));
            item.append(text, bar, value);
            list.append(item);
        }
        card.replaceChildren(panelHead(title, sub), rows.length ? list : el('p', 'quiet', empty));
    }

    /**
     * A card that needs calendar access: shows the list when connected,
     * otherwise a short invitation to connect.
     */
    function renderCalendarCard(card, calendar, options) {
        if (!calendar.available) {
            card.hidden = true;
            return;
        }
        if (calendar.enabled && calendar.status === 'granted') {
            renderList(card, options);
            return;
        }

        const blocked = calendar.enabled && calendar.status !== 'not-determined';
        const prompt = el('div', 'connect');
        prompt.append(el('p', '', blocked
            ? 'Calendar access is turned off for Sound Meter. Switch it on in System Settings to see your meetings here.'
            : 'See which meetings and people bring out your loud side. Event details are read on this Mac and never stored or sent.'));
        const button = el('button', 'btn', blocked ? 'Open System Settings' : 'Connect Calendar');
        button.type = 'button';
        button.id = 'connect-calendar';
        button.addEventListener('click', async () => {
            button.disabled = true;
            await api.connectCalendar();
            load();
        });
        prompt.append(button);
        card.hidden = false;
        card.replaceChildren(panelHead(options.title, options.promptSub || options.sub), prompt);
    }

    function renderApps(card, rows, sub) {
        if (!rows.length) {
            card.hidden = true;
            return;
        }
        renderList(card, {
            title: 'Where',
            sub,
            rows,
            empty: '',
            detail: (row) => `${duration(row.seconds)} monitored`
        });
    }

    /* --------------------------------------------------------------- day */

    function renderDayMetrics(summary, previous) {
        const share = summary.seconds ? summary.loudSeconds / summary.seconds : 0;
        const prevShare = previous && previous.seconds ? previous.loudSeconds / previous.seconds : null;
        const versus = previous ? escapeHtml(`vs ${shortDayName(previous.date)}`) : '';
        const minutes = dayData.minutes;

        renderMetrics($('day-metrics'), [
            {
                label: 'Loud time',
                value: duration(summary.loudSeconds),
                note: prevShare === null
                    ? `${Math.round(share * 100)}% of monitored time`
                    : `${delta(share * 100, prevShare * 100, ' pts') || `${Math.round(share * 100)}% · same `}${versus}`
            },
            {
                label: 'Average level',
                value: pct(summary.avg),
                unit: '%',
                note: previous
                    ? `${delta(summary.avg * 100, previous.avg * 100, ' pts') || 'Same '}${versus}`
                    : escapeHtml(ZONE_LABELS[V.zoneForRatio(summary.avg)])
            },
            {
                label: 'Peak',
                value: pct(summary.peak),
                unit: '%',
                note: summary.peak >= 1 ? 'Above your limit' : 'Of your limit'
            },
            {
                label: 'Time monitored',
                value: duration(summary.seconds),
                note: minutes.length ? `${time(minutes[0].t)} – ${time(minutes[minutes.length - 1].t + MINUTE)}` : ''
            }
        ]);
    }

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
            (nearest.loud ? `<div><span>Too loud</span><span>${nearest.loud}s</span></div>` : '') +
            (nearest.app ? `<div><span>On</span><span>${escapeHtml(nearest.app)}</span></div>` : '');
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

    function renderDays() {
        const byDate = new Map(days.map((d) => [d.date, d]));
        const maxLoud = Math.max(60, ...days.map((d) => d.loudSeconds));
        const buttons = [];

        for (let i = DAYS_SHOWN - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const key = dateKey(date);
            const summary = byDate.get(key);

            const button = el('button', 'day');
            button.type = 'button';
            button.setAttribute('role', 'option');
            button.setAttribute('aria-selected', String(key === selected));
            button.disabled = !summary;
            button.title = summary
                ? `${dayName(key)}: ${duration(summary.loudSeconds)} too loud of ${duration(summary.seconds)} monitored`
                : `${dayName(key)}: no data`;

            const track = el('span', 'track');
            const bar = el('span', 'bar');
            if (summary) {
                const share = summary.seconds ? summary.loudSeconds / summary.seconds : 0;
                if (share > 0.15) bar.classList.add('lots');
                else if (share > 0.05) bar.classList.add('some');
                bar.style.height = `${Math.max(4, (summary.loudSeconds / maxLoud) * 100)}%`;
            }
            track.append(bar);

            button.append(
                el('span', 'count', summary ? `${Math.round(summary.loudSeconds / 60)}m` : ''),
                track,
                el('span', 'label', i === 0 ? 'Today' : date.toLocaleDateString([], { weekday: 'short', day: 'numeric' })));
            button.addEventListener('click', () => select(key));
            buttons.push(button);
        }

        $('days').replaceChildren(...buttons);
    }

    async function select(date) {
        selected = date;
        const data = await api.getDay(date);
        if (!data) return;
        dayData = data;

        const index = days.findIndex((d) => d.date === date);
        const previous = index >= 0 ? days[index + 1] : null;
        const { summary } = dayData;

        $('subtitle').textContent = parseKey(date).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        $('chart-title').textContent = dayName(date);
        $('chart-sub').textContent = summary.loudSeconds > 0 && summary.loudestAt
            ? `Loudest around ${time(summary.loudestAt)}.`
            : 'No loud moments. Nicely done.';

        renderDayMetrics(summary, previous);
        renderChart();
        renderCalendarCard($('day-meetings'), dayData.calendar, {
            title: 'Meetings',
            sub: 'How loud you were in each one.',
            promptSub: 'Connect your calendar to break the day down by meeting.',
            rows: dayData.meetings || [],
            empty: 'No meetings overlapped the time you were monitored.',
            detail: (row) => `${time(row.start)} – ${time(row.end)}`
        });
        renderApps($('day-apps'), dayData.apps, 'The app you were on a call with.');
        renderDays();
        onChartLeave();
    }

    /* ------------------------------------------------------------ trends */

    function renderTrendMetrics(week) {
        const { current, previous, streak, calmShare } = week;
        const now = current || { seconds: 0, loudSeconds: 0, avg: 0, share: 0 };

        renderMetrics($('trend-metrics'), [
            {
                label: 'Loud time · 7 days',
                value: duration(now.loudSeconds),
                note: previous
                    ? `${delta(now.share * 100, previous.share * 100, ' pts') || `${Math.round(now.share * 100)}% · same `}vs the week before`
                    : `${Math.round(now.share * 100)}% of monitored time`
            },
            {
                label: 'Average level · 7 days',
                value: pct(now.avg),
                unit: '%',
                note: previous
                    ? `${delta(now.avg * 100, previous.avg * 100, ' pts') || 'Same '}vs the week before`
                    : escapeHtml(ZONE_LABELS[V.zoneForRatio(now.avg)])
            },
            {
                label: 'Calm streak',
                value: plural(streak, 'day'),
                note: `Days in a row under ${Math.round(calmShare * 100)}% loud time`
            },
            {
                label: 'Monitored · 7 days',
                value: duration(now.seconds),
                note: previous ? `${duration(previous.seconds)} the week before` : ''
            }
        ]);
    }

    function renderHeatmap(heatmap) {
        const container = $('heatmap');
        if (!heatmap.cells.length) {
            container.replaceChildren(el('p', 'quiet', 'Patterns appear after a few days of use.'));
            $('heatmap-sub').textContent = 'Average level by weekday and hour.';
            return;
        }

        const { loudest } = heatmap;
        $('heatmap-sub').textContent = loudest
            ? `You’re loudest on ${WEEKDAYS[loudest.dow]}s around ${hourLabel(loudest.hour)}.`
            : 'Average level by weekday and hour.';

        // Always show the working week and a full working day; widen for
        // anything outside it.
        const firstHour = Math.min(heatmap.hours[0], 9);
        const lastHour = Math.max(heatmap.hours[1], 17);
        const rows = [...new Set([0, 1, 2, 3, 4, ...heatmap.days])].sort((a, b) => a - b);
        const byKey = new Map(heatmap.cells.map((c) => [`${c.dow}-${c.hour}`, c]));
        const columns = lastHour - firstHour + 1;
        const labelEvery = columns > 12 ? 3 : 2;

        const grid = el('div', 'heat-grid');
        grid.style.gridTemplateColumns = `auto repeat(${columns}, minmax(0, 1fr))`;

        grid.append(el('span'));
        for (let hour = firstHour; hour <= lastHour; hour++) {
            grid.append(el('span', 'heat-hour', (hour - firstHour) % labelEvery === 0 ? hourLabel(hour) : ''));
        }

        for (const dow of rows) {
            grid.append(el('span', 'heat-day', WEEKDAYS[dow].slice(0, 3)));
            for (let hour = firstHour; hour <= lastHour; hour++) {
                const cell = el('i', 'heat-cell');
                const data = byKey.get(`${dow}-${hour}`);
                if (data) {
                    // An hour that averages at the "too loud" line is as red as it gets.
                    const intensity = Math.min(data.avg / LOUD_RATIO, 1);
                    cell.style.background = rgb(V.colorForRatio(intensity), 0.35 + intensity * 0.65);
                    cell.classList.add('on');
                    cell.title = `${WEEKDAYS[dow]} ${hourLabel(hour)} · average ${pct(data.avg)}% · ${duration(data.seconds)} monitored`;
                    cell.dataset.avg = String(data.avg);
                }
                grid.append(cell);
            }
        }
        container.replaceChildren(grid);
    }

    async function loadTrends() {
        const trends = await api.getTrends();
        $('subtitle').textContent = `Last ${Math.round(trends.days / 7)} weeks`;
        renderTrendMetrics(trends.week);
        renderHeatmap(trends.heatmap);

        renderCalendarCard($('trend-meetings'), trends.calendar, {
            title: 'Meetings',
            sub: 'Loudest first, with repeats rolled together.',
            promptSub: 'Connect your calendar to see which meetings get loud.',
            rows: trends.meetings || [],
            empty: 'No meetings overlapped the time you were monitored.',
            detail: (row) => `${plural(row.sessions, 'session')} · ${duration(row.seconds)}`
        });

        const connected = trends.calendar.available && trends.calendar.enabled && trends.calendar.status === 'granted';
        if (connected) {
            renderList($('trend-people'), {
                title: 'People',
                sub: 'Who you tend to be loud with.',
                rows: trends.people || [],
                empty: 'No small meetings with other people yet.',
                detail: (row) => `${plural(row.sessions, 'meeting')} · ${duration(row.seconds)}`
            });
        } else {
            $('trend-people').hidden = true;
        }
        renderApps($('trend-apps'), trends.apps, 'Loudness by the app you were on a call with.');
    }

    /* -------------------------------------------------------------- data */

    function showView() {
        const hasData = days.length > 0;
        $('empty').hidden = hasData;
        $('view-day').hidden = !hasData || view !== 'day';
        $('view-trends').hidden = !hasData || view !== 'trends';
        $('tabs').hidden = !hasData;
        $('share').hidden = !hasData;
        $('export').disabled = !hasData;
        $('clear').disabled = !hasData;
        document.querySelectorAll('#tabs button').forEach((button) => {
            button.setAttribute('aria-pressed', String(button.dataset.view === view));
        });
    }

    async function load() {
        days = await api.listDays(DAYS_SHOWN + 1);
        showView();
        if (!days.length) {
            $('subtitle').textContent = 'How your day sounded';
            return;
        }
        if (view === 'trends') {
            await loadTrends();
        } else {
            if (!selected || !days.some((d) => d.date === selected)) selected = days[0].date;
            await select(selected);
        }
    }

    /* -------------------------------------------------------------- live */

    let liveTimer = null;

    function onSample(sample) {
        const live = $('live');
        const zone = V.zoneForRatio(sample.avg);
        const { r, g, b } = V.colorForRatio(Math.min(sample.avg, 1));
        live.hidden = false;
        live.querySelector('i').style.setProperty('--c', `${r} ${g} ${b}`);
        $('live-text').textContent = ZONE_LABELS[zone];
        clearTimeout(liveTimer);
        liveTimer = setTimeout(() => { live.hidden = true; }, 3000);
    }

    /* -------------------------------------------------------------- boot */

    $('tabs').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-view]');
        if (!button || button.dataset.view === view) return;
        view = button.dataset.view;
        showView();
        load();
    });

    // Share: a card of the week's totals plus a link that shows the same
    // card wherever it is pasted. The main process builds both.
    let statusTimer = null;
    function shareStatus(done, message) {
        if (!done) return;
        const status = $('share-status');
        status.textContent = message;
        status.classList.add('show');
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => status.classList.remove('show'), 2600);
    }
    const cardImage = () => $('share-canvas').toDataURL('image/png');

    async function openShare() {
        const share = await api.share.prepare();
        if (!share) return;
        window.ShareCard.draw($('share-canvas'), share.card);
        $('share-url').textContent = share.displayUrl;

        const chips = share.destinations.map(({ key, label }) => {
            const chip = el('button', 'chip', label);
            chip.type = 'button';
            chip.dataset.destination = key;
            chip.addEventListener('click', () => api.share.open(key));
            return chip;
        });
        const more = el('button', 'chip', 'More…');
        more.type = 'button';
        more.id = 'share-more';
        more.title = 'Messages, Mail, AirDrop and more';
        more.addEventListener('click', () => api.share.more(cardImage()));
        $('share-destinations').replaceChildren(...chips, more);

        $('share-status').classList.remove('show');
        if (!$('share-dialog').open) $('share-dialog').showModal();
        $('share-copy-link').focus();
    }
    $('share').addEventListener('click', openShare);
    // The weekly recap notification lands here: show the week, ready to share.
    api.onShareRequest(async () => {
        view = 'trends';
        await load();
        openShare();
    });
    $('share-close').addEventListener('click', () => $('share-dialog').close());
    $('share-dialog').addEventListener('click', (event) => {
        if (event.target === $('share-dialog')) $('share-dialog').close(); // Click on the backdrop
    });
    $('share-copy-link').addEventListener('click', async () => shareStatus(await api.share.copyLink(), 'Link copied'));
    $('share-copy-image').addEventListener('click', async () => shareStatus(await api.share.copyImage(cardImage()), 'Image copied'));
    $('share-save').addEventListener('click', async () => shareStatus(await api.share.saveImage(cardImage()), 'Image saved'));

    $('export').addEventListener('click', () => api.exportHistory());
    $('clear').addEventListener('click', async () => {
        if (await api.clearHistory()) {
            selected = null;
            view = 'day';
            load();
        }
    });
    $('chart-svg').addEventListener('mousemove', onChartMove);
    $('chart-svg').addEventListener('mouseleave', onChartLeave);
    new ResizeObserver(() => { if (dayData && view === 'day') renderChart(); }).observe($('chart'));

    api.onSample(onSample);
    api.onState(() => load()); // e.g. calendar switched on or off from the menu
    setInterval(() => {
        if (document.visibilityState === 'visible') load();
    }, REFRESH_MS);
    window.addEventListener('focus', load);

    load();
})();
