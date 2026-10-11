import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fileGet = vi.fn();
const getMetadata = vi.fn();
const download = vi.fn();
const fileFn = vi.fn(() => ({ getMetadata, download }));
const bucketFn = vi.fn(() => ({ file: fileFn }));
const requireAdmin = vi.fn();
const collectionFn = vi.fn(() => ({ doc: vi.fn(() => ({ get: fileGet })) }));

vi.mock('../init', () => ({
    db: { collection: collectionFn },
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
const PART = 6 * 1024 * 1024;

function fileDoc(data: Record<string, unknown> | null) {
    return { exists: data !== null, data: () => data ?? undefined };
}

describe('readMediaFile', () => {
    let handler: Function;
    let mediaFilePath: (data: any, prefix?: string) => string | null;

    beforeEach(async () => {
        vi.clearAllMocks();
        delete process.env.ARC_STORAGE_PREFIX;
        delete process.env.ARC_STORAGE_BUCKET;
        requireAdmin.mockResolvedValue(undefined);
        const mod = await import('./readMediaFile.js');
        mediaFilePath = mod.mediaFilePath;
        handler = mockOnCall.mock.calls[mockOnCall.mock.calls.length - 1][0];
    });

    afterEach(() => {
        vi.resetModules();
    });

    describe('mediaFilePath', () => {
        it('is the record\'s own path in the library folder', () => {
            expect(mediaFilePath({ path: 'mediaFiles/a-b1c2d3.pdf' }, '')).toBe('mediaFiles/a-b1c2d3.pdf');
            expect(mediaFilePath({ path: 'arccms/mediaFiles/a-b1c2d3.pdf' }, 'arccms/')).toBe('arccms/mediaFiles/a-b1c2d3.pdf');
        });

        it('refuses anything outside the library folder', () => {
            expect(mediaFilePath({ path: 'users/u1/secret.pdf' }, '')).toBeNull();
            expect(mediaFilePath({ path: 'mediaFiles/../users/u1/x.pdf' }, '')).toBeNull();
            expect(mediaFilePath({ path: 'mediaFiles/sub/x.pdf' }, '')).toBeNull();
            expect(mediaFilePath({ path: 'mediaFiles/x.pdf' }, 'arccms/')).toBeNull();
            expect(mediaFilePath({ path: 'mediaFiles/' }, '')).toBeNull();
            expect(mediaFilePath({}, '')).toBeNull();
            expect(mediaFilePath(undefined, '')).toBeNull();
        });
    });

    it('is for admins only', async () => {
        requireAdmin.mockRejectedValue(Object.assign(new Error('Admin access required.'), { code: 'permission-denied' }));
        await expect(handler({ auth: { uid: 'm1', token: {} }, data: { fileId: 'f' } })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(fileGet).not.toHaveBeenCalled();
    });

    it('needs a file id and a part start', async () => {
        await expect(handler({ ...admin, data: {} })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(handler({ ...admin, data: { fileId: 'a/b' } })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(handler({ ...admin, data: { fileId: 'f', offset: 5 } })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(handler({ ...admin, data: { fileId: 'f', offset: -PART } })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(handler({ ...admin, data: { fileId: 'f', offset: '0' } })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(fileGet).not.toHaveBeenCalled();
    });

    it('reads the mediaFiles record, never another collection', async () => {
        fileGet.mockResolvedValue(fileDoc(null));
        await expect(handler({ ...admin, data: { fileId: 'f' } })).rejects.toMatchObject({ code: 'not-found' });
        expect(collectionFn).toHaveBeenCalledWith('mediaFiles');
    });

    it('refuses a file that is not a PDF', async () => {
        fileGet.mockResolvedValue(fileDoc({ type: 'word', path: 'mediaFiles/a.docx' }));
        await expect(handler({ ...admin, data: { fileId: 'f' } })).rejects.toMatchObject({ code: 'failed-precondition' });
        fileGet.mockResolvedValue(fileDoc({ type: 'pdf', path: 'mediaFiles/a.docx' }));
        await expect(handler({ ...admin, data: { fileId: 'f' } })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(download).not.toHaveBeenCalled();
    });

    it('refuses a record pointing outside the library', async () => {
        fileGet.mockResolvedValue(fileDoc({ type: 'pdf', path: 'users/u1/private.pdf' }));
        await expect(handler({ ...admin, data: { fileId: 'f' } })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(fileFn).not.toHaveBeenCalled();
    });

    it('refuses a file over 20 MB, and an offset past the end', async () => {
        fileGet.mockResolvedValue(fileDoc({ type: 'pdf', path: 'mediaFiles/a.pdf' }));
        getMetadata.mockResolvedValue([{ size: String(20 * 1024 * 1024 + 1) }]);
        await expect(handler({ ...admin, data: { fileId: 'f' } })).rejects.toMatchObject({ code: 'failed-precondition' });
        getMetadata.mockResolvedValue([{ size: String(PART) }]);
        await expect(handler({ ...admin, data: { fileId: 'f', offset: PART } })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(download).not.toHaveBeenCalled();
    });

    it('says when the file is missing from Storage', async () => {
        fileGet.mockResolvedValue(fileDoc({ type: 'pdf', path: 'mediaFiles/a.pdf' }));
        getMetadata.mockRejectedValue(new Error('No such object'));
        await expect(handler({ ...admin, data: { fileId: 'f' } })).rejects.toMatchObject({ code: 'not-found' });
    });

    it('returns parts that put back together make the whole file', async () => {
        process.env.ARC_STORAGE_BUCKET = 'my-bucket';
        const whole = Buffer.alloc(PART * 2 + 10, 7);
        whole[0] = 1;
        whole[PART] = 2;
        whole[whole.length - 1] = 3;
        fileGet.mockResolvedValue(fileDoc({ type: 'pdf', path: 'mediaFiles/big.pdf' }));
        getMetadata.mockResolvedValue([{ size: String(whole.length) }]);
        download.mockImplementation(async ({ start, end }: { start: number; end: number }) => [whole.subarray(start, end + 1)]);

        const parts: Buffer[] = [];
        let offset = 0;
        let total = Infinity;
        while (offset < total) {
            const result = await handler({ ...admin, data: { fileId: 'f', offset } });
            total = result.total;
            expect(result.offset).toBe(offset);
            const part = Buffer.from(result.data, 'base64');
            parts.push(part);
            offset += part.length;
        }

        expect(bucketFn).toHaveBeenCalledWith('my-bucket');
        expect(fileFn).toHaveBeenCalledWith('mediaFiles/big.pdf');
        expect(parts).toHaveLength(3);
        expect(Buffer.concat(parts).equals(whole)).toBe(true);
        expect(download).toHaveBeenNthCalledWith(1, { start: 0, end: PART - 1 });
    });
});
