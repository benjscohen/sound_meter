// Where the floating orb may sit. Its window is much bigger than the orb
// (it has to hold the glow at full size), and is allowed to hang over the
// edge of the screen, so what is kept on screen is the orb itself.

const EDGE_GAP = 6;             // Closest the resting orb comes to a screen edge
const DEFAULT_GAP = 24;         // Where it starts: this far in from the top-right corner

const distance = (value, min, max) => (value < min ? min - value : value > max ? value - max : 0);

/** The work area (of several) that a point is in or closest to. */
function nearestArea(point, areas) {
    let best = null;
    let bestDistance = Infinity;
    for (const area of areas) {
        const d = Math.hypot(
            distance(point.x, area.x, area.x + area.width),
            distance(point.y, area.y, area.y + area.height));
        if (d < bestDistance) {
            best = area;
            bestDistance = d;
        }
    }
    return best;
}

/** Moves a centre the least it takes for an orb of this diameter to be wholly inside the area. */
function clampCentre(point, area, diameter) {
    const reach = diameter / 2 + EDGE_GAP;
    const within = (value, start, length) =>
        // An area too small for the orb gets it in the middle.
        length < reach * 2 ? start + length / 2 : Math.min(Math.max(value, start + reach), start + length - reach);
    return { x: Math.round(within(point.x, area.x, area.width)), y: Math.round(within(point.y, area.y, area.height)) };
}

/** Tucked into the top-right corner. */
function defaultCentre(area, diameter) {
    const inset = diameter / 2 + DEFAULT_GAP;
    return clampCentre({ x: area.x + area.width - inset, y: area.y + inset }, area, diameter);
}

/**
 * Where the orb's centre goes: the saved spot if there is one, nudged back
 * on to the nearest screen if need be; otherwise the default corner.
 */
function resolveCentre({ saved, areas, primary, diameter }) {
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        const area = nearestArea(saved, areas);
        if (area) return clampCentre(saved, area, diameter);
    }
    return defaultCentre(primary, diameter);
}

/** How far a centre is from the sides and the bottom of its area: the room the orb's labels have. */
function roomAround(centre, area) {
    return {
        left: centre.x - area.x,
        right: area.x + area.width - centre.x,
        below: area.y + area.height - centre.y
    };
}

module.exports = { EDGE_GAP, DEFAULT_GAP, nearestArea, clampCentre, defaultCentre, resolveCentre, roomAround };
