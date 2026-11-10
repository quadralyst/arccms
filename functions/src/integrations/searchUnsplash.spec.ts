import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock ../init before importing the function
vi.mock('../init', () => ({
    db: {
        collection: vi.fn().mockReturnValue({
            doc: vi.fn().mockReturnValue({
                get: vi.fn(),
            }),
        }),
    },
    owner: {},
}));

// Mock firebase-functions/v2/https
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

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const ADMIN = { uid: 'admin1', token: { arccms_role: 'admin' } };

describe('searchUnsplash', () => {
    let handler: Function;
    let mockDb: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Import after mocks are set up — side effect triggers onCall registration
        await import('./searchUnsplash.js');

        // Extract the handler — it is the last call to onCall
        const calls = mockOnCall.mock.calls;
        handler = calls[calls.length - 1][0];

        // Get the mocked db
        const init = await import('../init.js');
        mockDb = init.db;
    });

    afterEach(() => {
        vi.resetModules();
    });

    describe('authentication', () => {
        it('should throw unauthenticated if no auth context', async () => {
            await expect(handler({ auth: null, data: { query: 'nature', page: 1 } }))
                .rejects.toMatchObject({ code: 'unauthenticated' });
        });

        it('should refuse a signed-in account that is not an admin', async () => {
            await expect(handler({ auth: { uid: 'member1', token: { arccms_role: 'user' } }, data: { query: 'nature', page: 1 } }))
                .rejects.toMatchObject({ code: 'permission-denied' });
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('warmup', () => {
        it('should return { ok: true } for warmup ping without calling Firestore or Unsplash', async () => {
            const result = await handler({ auth: ADMIN, data: { warmup: true } });

            expect(result).toEqual({ ok: true });
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('input validation', () => {
        it('should throw invalid-argument if query is missing', async () => {
            await expect(handler({ auth: ADMIN, data: { page: 1 } }))
                .rejects.toMatchObject({ code: 'invalid-argument' });
        });

        it('should throw invalid-argument if query is empty string', async () => {
            await expect(handler({ auth: ADMIN, data: { query: '   ', page: 1 } }))
                .rejects.toMatchObject({ code: 'invalid-argument' });
        });

        it.each([0, -1, 1.5, '2', 101, 1e9, null])('should throw invalid-argument for page %s', async (page) => {
            await expect(handler({ auth: ADMIN, data: { query: 'nature', page } }))
                .rejects.toMatchObject({ code: 'invalid-argument' });
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('Firestore settings lookup', () => {
        it('should throw not-found if Settings/integrations document does not exist', async () => {
            mockDb.collection.mockReturnValue({
                doc: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
                }),
            });

            await expect(handler({ auth: ADMIN, data: { query: 'nature', page: 1 } }))
                .rejects.toMatchObject({ code: 'not-found' });
        });

        it('should throw not-found if unsplash.accessKey is missing', async () => {
            mockDb.collection.mockReturnValue({
                doc: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({ unsplash: {} }),
                    }),
                }),
            });

            await expect(handler({ auth: ADMIN, data: { query: 'nature', page: 1 } }))
                .rejects.toMatchObject({ code: 'not-found' });
        });
    });

    describe('Unsplash API call', () => {
        beforeEach(() => {
            mockDb.collection.mockReturnValue({
                doc: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({ unsplash: { accessKey: 'test-key-123' } }),
                    }),
                }),
            });
        });

        it('should call Unsplash API with correct URL and auth header', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ results: [], total: 0 }),
            });

            await handler({ auth: ADMIN, data: { query: 'nature', page: 1 } });

            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('query=nature'),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: 'Client-ID test-key-123',
                    }),
                })
            );
        });

        it('should encode the query in the URL', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ results: [], total: 0 }),
            });

            await handler({ auth: ADMIN, data: { query: 'blue ocean', page: 2 } });

            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('blue%20ocean'),
                expect.any(Object)
            );
        });

        it('should return correctly shaped pagination', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ results: [{}, {}], total: 100 }),
            });

            const result = await handler({ auth: ADMIN, data: { query: 'nature', page: 3 } });

            expect(result.pagination).toEqual({
                pageIndex: 3,
                pageSize: 20,
                totalItems: 100,
                totalPages: 5,
            });
            expect(result.status).toBe(200);
        });

        it('should throw internal error if Unsplash API returns non-ok response', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 403,
                statusText: 'Forbidden',
            });

            await expect(handler({ auth: ADMIN, data: { query: 'nature', page: 1 } }))
                .rejects.toMatchObject({ code: 'internal' });
        });
    });

    it('never offers more pages than a search may ask for', async () => {
        mockDb.collection.mockReturnValue({
            doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ unsplash: { accessKey: 'k' } }) }),
            }),
        });
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [], total: 50_000 }) });
        const result = await handler({ auth: ADMIN, data: { query: 'sea', page: 100 } });
        expect(result.pagination).toMatchObject({ totalItems: 2000, totalPages: 100 });
    });
});
