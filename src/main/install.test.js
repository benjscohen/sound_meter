const { shouldOfferMove, moveToApplications } = require('./install');

describe('shouldOfferMove', () => {
    const elsewhere = { platform: 'darwin', packaged: true, inApplications: false, declined: false };

    test('offers when a released build runs outside Applications', () => {
        expect(shouldOfferMove(elsewhere)).toBe(true);
    });

    test.each([
        ['already in Applications', { inApplications: true }],
        ['in development', { packaged: false }],
        ['already turned down', { declined: true }],
        ['not on a Mac', { platform: 'win32' }]
    ])('stays quiet when %s', (_label, change) => {
        expect(shouldOfferMove({ ...elsewhere, ...change })).toBe(false);
    });
});

describe('moveToApplications', () => {
    test('reports a move that is under way', () => {
        expect(moveToApplications({ moveToApplicationsFolder: () => true })).toEqual({ moved: true });
    });

    test('reports staying put when the copy in Applications is kept', () => {
        expect(moveToApplications({ moveToApplicationsFolder: () => false })).toEqual({ moved: false });
    });

    test('reports staying put, without throwing, when the move fails', () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const app = { moveToApplicationsFolder: () => { throw new Error('User rejected the authorization request'); } };
        expect(moveToApplications(app)).toEqual({ moved: false });
        console.error.mockRestore();
    });
});
