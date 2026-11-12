const { EDGE_GAP, DEFAULT_GAP, nearestArea, clampCentre, defaultCentre, resolveCentre, roomAround } = require('./placement');

// A laptop screen below its menu bar, and a second display to its right.
const laptop = { x: 0, y: 33, width: 1512, height: 949 };
const external = { x: 1512, y: 0, width: 1920, height: 1080 };
const DIAMETER = 60;
const reach = DIAMETER / 2 + EDGE_GAP;

describe('clampCentre', () => {
    test('leaves a spot in the open alone', () => {
        expect(clampCentre({ x: 700, y: 500 }, laptop, DIAMETER)).toEqual({ x: 700, y: 500 });
    });

    test('lets the orb sit right in each corner', () => {
        expect(clampCentre({ x: 5000, y: -5000 }, laptop, DIAMETER)).toEqual({ x: 1512 - reach, y: 33 + reach });
        expect(clampCentre({ x: -5000, y: 5000 }, laptop, DIAMETER)).toEqual({ x: reach, y: 33 + 949 - reach });
    });

    test('keeps the whole orb below the menu bar', () => {
        const { y } = clampCentre({ x: 700, y: 0 }, laptop, DIAMETER);
        expect(y - DIAMETER / 2).toBeGreaterThanOrEqual(laptop.y);
    });

    test('a bigger orb stops further from the edge', () => {
        expect(clampCentre({ x: 0, y: 500 }, laptop, 76).x).toBe(38 + EDGE_GAP);
        expect(clampCentre({ x: 0, y: 500 }, laptop, 44).x).toBe(22 + EDGE_GAP);
    });

    test('an area smaller than the orb gets it in the middle', () => {
        expect(clampCentre({ x: 0, y: 0 }, { x: 100, y: 100, width: 40, height: 40 }, DIAMETER)).toEqual({ x: 120, y: 120 });
    });

    test('gives whole pixels', () => {
        const at = clampCentre({ x: 700.4, y: 500.6 }, laptop, DIAMETER);
        expect(at).toEqual({ x: 700, y: 501 });
    });
});

describe('nearestArea', () => {
    test('picks the screen a point is on', () => {
        expect(nearestArea({ x: 2000, y: 500 }, [laptop, external])).toBe(external);
        expect(nearestArea({ x: 200, y: 500 }, [laptop, external])).toBe(laptop);
    });

    test('picks the closest screen for a point on none', () => {
        expect(nearestArea({ x: 700, y: 10 }, [laptop, external])).toBe(laptop);     // Under the menu bar
        expect(nearestArea({ x: 9000, y: 500 }, [laptop, external])).toBe(external);
    });

    test('has nothing to offer without screens', () => {
        expect(nearestArea({ x: 0, y: 0 }, [])).toBeNull();
    });
});

describe('defaultCentre', () => {
    test('is tucked into the top-right corner', () => {
        const inset = DIAMETER / 2 + DEFAULT_GAP;
        expect(defaultCentre(laptop, DIAMETER)).toEqual({ x: 1512 - inset, y: 33 + inset });
    });
});

describe('resolveCentre', () => {
    const screens = { areas: [laptop, external], primary: laptop, diameter: DIAMETER };

    test('uses the default corner when nothing is saved', () => {
        expect(resolveCentre({ ...screens, saved: null })).toEqual(defaultCentre(laptop, DIAMETER));
        expect(resolveCentre({ ...screens, saved: { x: 'left', y: 4 } })).toEqual(defaultCentre(laptop, DIAMETER));
    });

    test('keeps a saved spot, on whichever screen it is', () => {
        expect(resolveCentre({ ...screens, saved: { x: 2400, y: 300 } })).toEqual({ x: 2400, y: 300 });
    });

    test('brings a spot from an unplugged screen back to the nearest one', () => {
        const at = resolveCentre({ areas: [laptop], primary: laptop, diameter: DIAMETER, saved: { x: 2400, y: 300 } });
        expect(at).toEqual({ x: 1512 - reach, y: 300 });
    });
});

describe('roomAround', () => {
    test('measures to the sides and the bottom of the screen the orb is on', () => {
        expect(roomAround({ x: 1476, y: 69 }, laptop)).toEqual({ left: 1476, right: 36, below: 913 });
        expect(roomAround({ x: 1612, y: 1000 }, external)).toEqual({ left: 100, right: 1820, below: 80 });
    });
});
