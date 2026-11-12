const { offerMoveToApplications } = require('./install');

const platform = process.platform;
beforeAll(() => Object.defineProperty(process, 'platform', { value: 'darwin' }));
afterAll(() => Object.defineProperty(process, 'platform', { value: platform }));

function setup({ packaged = true, inApplications = false, declined = false, answer = 0, move = () => true } = {}) {
    const saved = { declinedMove: declined };
    const dialogs = [];
    const deps = {
        app: {
            isPackaged: packaged,
            isInApplicationsFolder: () => inApplications,
            moveToApplicationsFolder: jest.fn(move)
        },
        dialog: {
            showMessageBox: jest.fn(async (options) => {
                dialogs.push(options);
                return { response: dialogs.length === 1 ? answer : 0 };
            })
        },
        settings: {
            get: (key) => saved[key],
            update: (patch) => { Object.assign(saved, patch); return true; }
        }
    };
    return { deps, dialogs, saved };
}

describe('offerMoveToApplications', () => {
    test('says nothing when already in Applications', async () => {
        const { deps, dialogs } = setup({ inApplications: true });
        expect(await offerMoveToApplications(deps)).toBe(false);
        expect(dialogs).toHaveLength(0);
    });

    test('says nothing in development', async () => {
        const { deps, dialogs } = setup({ packaged: false });
        expect(await offerMoveToApplications(deps)).toBe(false);
        expect(dialogs).toHaveLength(0);
    });

    test('moves when asked to, and reports that the app is on its way out', async () => {
        const { deps, dialogs } = setup();
        expect(await offerMoveToApplications(deps)).toBe(true);
        expect(dialogs[0].buttons).toEqual(['Move to Applications', 'Not Now']);
        expect(deps.app.moveToApplicationsFolder).toHaveBeenCalledTimes(1);
    });

    test('"Not Now" is remembered, so it only asks once', async () => {
        const { deps, dialogs, saved } = setup({ answer: 1 });
        expect(await offerMoveToApplications(deps)).toBe(false);
        expect(deps.app.moveToApplicationsFolder).not.toHaveBeenCalled();
        expect(saved.declinedMove).toBe(true);
        expect(await offerMoveToApplications(deps)).toBe(false);
        expect(dialogs).toHaveLength(1);
    });

    test('carries on where it is if the move fails, and says what to do', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const { deps, dialogs } = setup({ move: () => { throw new Error('read-only'); } });
        expect(await offerMoveToApplications(deps)).toBe(false);
        expect(dialogs).toHaveLength(2);
        expect(dialogs[1].detail).toMatch(/Drag Sound Meter into your Applications folder/);
        console.error.mockRestore();
    });

    test('carries on where it is if the copy in Applications is kept', async () => {
        const { deps } = setup({ move: () => false });
        expect(await offerMoveToApplications(deps)).toBe(false);
    });
});
