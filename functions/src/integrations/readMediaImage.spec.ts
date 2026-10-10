import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mediaGet = vi.fn();
const getMetadata = vi.fn();
const download = vi.fn();
const fileFn = vi.fn(() => ({ getMetadata, download }));
const bucketFn = vi.fn(() => ({ file: fileFn }));
const requireAdmin = vi.fn();

vi.mock('../init', () => ({
    db: { collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: mediaGet })) })) },
    storage: { bucket: bucketFn },
    owner: {},
}));

vi.mock('../search/auth', () => ({ requireAdmin }));

const mockOnCall = vi.fn();
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (handler: Function) => {
        mockOnCall(handler);
        return handler;
    },
    HttpsError: class HttpsError extends Error {
        constructor(public code: string, message: string) {
            super(message);
            this.name = 'HttpsError';
        }
    },
}));

const admin = { auth: { uid: 'a1', token: {} } };

function mediaDoc(data: Record<string, unknown> | null) {
    return { exists: data !== null, data: () => data ?? undefined };
}

describe('readMediaImage', () => {
    let handler: Function;
    let mediaSourcePath: (data: any, prefix?: string) => string | null;

    beforeEach(async () => {
        vi.clearAllMocks();
        delete process.env.ARC_STORAGE_PREFIX;
        delete process.env.ARC_STORAGE_BUCKET;
        requireAdmin.mockResolvedValue(undefined);
        const mod = await import('./readMediaImage.js');
        mediaSourcePath = mod.mediaSourcePath;
        handler = mockOnCall.mock.calls[mockOnCall.mock.calls.length - 1][0];
    });

    afterEach(() => {
        vi.resetModules();
    });

    describe('mediaSourcePath', () => {
        it('is the XL size of a sized upload', () => {
            expect(mediaSourcePath({ variants: { xl: { path: 'arccms/mediaImages/a-b1c2d3-xl.webp' } } }, 'arccms/'))
                .toBe('arccms/mediaImages/a-b1c2d3-xl.webp');
        });

        it('is the one file of an upload from before sizes existed', () => {
            const downloadURL = 'https://firebasestorage.googleapis.com/v0/b/x/o/mediaImages%2Fimage_1700.jpg?alt=media&token=t';
            expect(mediaSourcePath({ downloadURL }, '')).toBe('mediaImages/image_1700.jpg');
        });

        it('refuses anything outside the media library folder', () => {
            expect(mediaSourcePath({ variants: { xl: { path: 'users/u1/secret.webp' } } }, '')).toBeNull();
            expect(mediaSourcePath({ variants: { xl: { path: 'mediaImages/../users/u1/x.webp' } } }, '')).toBeNull();
            expect(mediaSourcePath({ variants: { xl: { path: 'mediaImages/sub/x.webp' } } }, '')).toBeNull();
            expect(mediaSourcePath({ variants: { xl: { path: 'mediaImages/x.webp' } } }, 'arccms/')).toBeNull();
            expect(mediaSourcePath({ downloadURL: 'https://example.com/photo.jpg' }, '')).toBeNull();
            expect(mediaSourcePath(undefined, '')).toBeNull();
        });
    });

    it('is for admins only', async () => {
        const denied = Object.assign(new Error('Admin access required.'), { code: 'permission-denied' });
        requireAdmin.mockRejectedValue(denied);
        await expect(handler({ auth: { uid: 'm1', token: {} }, data: { mediaId: 'm' } })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mediaGet).not.toHaveBeenCalled();
    });

    it('needs a media id', async () => {
        await expect(handler({ ...admin, data: {} })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(handler({ ...admin, data: { mediaId: 'a/b' } })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('says when the image is gone', async () => {
        mediaGet.mockResolvedValue(mediaDoc(null));
        await expect(handler({ ...admin, data: { mediaId: 'm' } })).rejects.toMatchObject({ code: 'not-found' });
    });

    it('refuses a GIF', async () => {
        mediaGet.mockResolvedValue(mediaDoc({ downloadURL: 'https://x/o/mediaImages%2Fparty-a1b2c3.gif?alt=media' }));
        await expect(handler({ ...admin, data: { mediaId: 'm' } })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(download).not.toHaveBeenCalled();
    });

    it('refuses a file too large to send back', async () => {
        mediaGet.mockResolvedValue(mediaDoc({ variants: { xl: { path: 'mediaImages/a-xl.webp' } } }));
        getMetadata.mockResolvedValue([{ size: String(20 * 1024 * 1024), contentType: 'image/webp' }]);
        await expect(handler({ ...admin, data: { mediaId: 'm' } })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(download).not.toHaveBeenCalled();
    });

    it('returns the XL file as base64 from the install bucket', async () => {
        process.env.ARC_STORAGE_BUCKET = 'my-bucket';
        mediaGet.mockResolvedValue(mediaDoc({ variants: { xl: { path: 'mediaImages/a-xl.webp' } } }));
        getMetadata.mockResolvedValue([{ size: '4', contentType: 'image/webp' }]);
        download.mockResolvedValue([Buffer.from('webp')]);

        const result = await handler({ ...admin, data: { mediaId: 'm' } });

        expect(bucketFn).toHaveBeenCalledWith('my-bucket');
        expect(fileFn).toHaveBeenCalledWith('mediaImages/a-xl.webp');
        expect(result).toEqual({ data: Buffer.from('webp').toString('base64'), contentType: 'image/webp' });
    });

    it('says when the file is missing from Storage', async () => {
        mediaGet.mockResolvedValue(mediaDoc({ variants: { xl: { path: 'mediaImages/a-xl.webp' } } }));
        getMetadata.mockRejectedValue(new Error('No such object'));
        await expect(handler({ ...admin, data: { mediaId: 'm' } })).rejects.toMatchObject({ code: 'not-found' });
    });
});
