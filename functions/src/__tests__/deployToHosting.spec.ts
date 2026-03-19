import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as zlib from 'node:zlib';
import * as crypto from 'node:crypto';

// ─── Hoisted mocks (available before vi.mock factories run) ─────────────────
const {
    mockFetch,
    mockGetAccessToken,
    mockGetClient,
    mockGoogleAuthClass,
    mockDocUpdate,
    mockDocSet,
    mockSubCollectionAdd,
    mockSubCollection,
    mockInnerDoc,
    mockCollection,
    mockTopDoc,
} = vi.hoisted(() => ({
    mockFetch: vi.fn(),
    mockGetAccessToken: vi.fn(),
    mockGetClient: vi.fn(),
    mockGoogleAuthClass: vi.fn(),
    mockDocUpdate: vi.fn(),
    mockDocSet: vi.fn(),
    mockSubCollectionAdd: vi.fn(),
    mockSubCollection: vi.fn(),
    mockInnerDoc: vi.fn(),
    mockCollection: vi.fn(),
    mockTopDoc: vi.fn(),
}));

// ─── Global fetch mock ──────────────────────────────────────────────────────
vi.stubGlobal('fetch', mockFetch);

// ─── GoogleAuth mock ────────────────────────────────────────────────────────
vi.mock('google-auth-library', () => ({
    GoogleAuth: mockGoogleAuthClass,
}));

// ─── Firestore mock ────────────────────────────────────────────────────────
vi.mock('../init', () => ({
    db: {
        collection: mockCollection,
        doc: mockTopDoc,
    },
}));

import { deployFileToHosting, removeFileFromHosting } from '../pages/deployToHosting.js';
import { GoogleAuth } from 'google-auth-library';

// ─── Test Helpers ───────────────────────────────────────────────────────────

const TEST_CONTENT = '<html><body>Test Page</body></html>';
const TEST_GZIPPED = zlib.gzipSync(Buffer.from(TEST_CONTENT, 'utf-8'), { level: 9 });
const TEST_HASH = crypto.createHash('sha256').update(TEST_GZIPPED).digest('hex');

function jsonResponse(data: any, ok = true, status = 200): Response {
    return {
        ok,
        status,
        json: () => Promise.resolve(data),
        text: () => Promise.resolve(JSON.stringify(data)),
    } as unknown as Response;
}

/**
 * Restore all mock implementations.
 * Called after vi.resetAllMocks() which clears BOTH state AND implementations.
 */
function restoreMockImplementations() {
    mockGetAccessToken.mockResolvedValue({ token: 'mock-token' });
    mockGetClient.mockResolvedValue({ getAccessToken: mockGetAccessToken });
    // Must use a regular function (not arrow) so vi.fn() works as a constructor with `new`
    mockGoogleAuthClass.mockImplementation(function () { return { getClient: mockGetClient }; });
    mockDocUpdate.mockResolvedValue(undefined);
    mockDocSet.mockResolvedValue(undefined);
    mockSubCollectionAdd.mockResolvedValue({ id: 'log-id' });
    mockSubCollection.mockReturnValue({ add: mockSubCollectionAdd });
    mockInnerDoc.mockReturnValue({ update: mockDocUpdate, collection: mockSubCollection });
    mockCollection.mockReturnValue({ doc: mockInnerDoc });
    mockTopDoc.mockReturnValue({ set: mockDocSet });
}

function setupHappyPathFetch(opts?: { uploadRequired?: boolean }) {
    const uploadRequired = opts?.uploadRequired !== false;
    mockFetch
        // Step 2: GET releases
        .mockResolvedValueOnce(jsonResponse({
            releases: [{ version: { name: 'sites/my-site/versions/v-old' } }],
        }))
        // Step 3: GET files
        .mockResolvedValueOnce(jsonResponse({
            files: [{ path: '/existing/page.html', hash: 'existing-hash-123' }],
        }))
        // Step 4: GET version config
        .mockResolvedValueOnce(jsonResponse({
            config: { rewrites: [{ glob: '**', function: 'server' }] },
        }))
        // Step 6: POST create version
        .mockResolvedValueOnce(jsonResponse({
            name: 'sites/my-site/versions/v-new',
        }))
        // Step 7: POST populateFiles
        .mockResolvedValueOnce(jsonResponse({
            uploadRequiredHashes: uploadRequired ? [TEST_HASH] : [],
            uploadUrl: 'https://upload.example.com/upload',
        }));

    if (uploadRequired) {
        // Step 8: POST upload
        mockFetch.mockResolvedValueOnce(jsonResponse({}));
    }

    mockFetch
        // Step 9a: PATCH finalize
        .mockResolvedValueOnce(jsonResponse({ status: 'FINALIZED' }))
        // Step 9b: POST release
        .mockResolvedValueOnce(jsonResponse({ name: 'release-1' }));
}

describe('deployFileToHosting', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        restoreMockImplementations();
        process.env.GCLOUD_PROJECT = 'test-project';
    });

    describe('happy path', () => {
        it('should authenticate with GoogleAuth using cloud-platform scope', async () => {
            setupHappyPathFetch();
            await deployFileToHosting('my-site', '/test.html', TEST_CONTENT, 'arc_articles', 'doc1');
            expect(GoogleAuth).toHaveBeenCalledWith({
                scopes: ['https://www.googleapis.com/auth/cloud-platform'],
            });
        });

        it('should call GET releases, GET files, GET config in sequence', async () => {
            setupHappyPathFetch();
            await deployFileToHosting('my-site', '/test.html', TEST_CONTENT, 'arc_articles', 'doc1');

            const calls = mockFetch.mock.calls;
            // Call 0: GET releases
            expect(calls[0][0]).toContain('/sites/my-site/releases?pageSize=1');
            expect(calls[0][1].method).toBe('GET');
            // Call 1: GET files
            expect(calls[1][0]).toContain('/versions/v-old/files');
            expect(calls[1][1].method).toBe('GET');
            // Call 2: GET version config
            expect(calls[2][0]).toContain('/versions/v-old');
            expect(calls[2][1].method).toBe('GET');
        });

        it('should create new version with preserved config', async () => {
            setupHappyPathFetch();
            await deployFileToHosting('my-site', '/test.html', TEST_CONTENT, 'arc_articles', 'doc1');

            const createCall = mockFetch.mock.calls[3];
            expect(createCall[0]).toContain('/sites/my-site/versions');
            expect(createCall[1].method).toBe('POST');
            const body = JSON.parse(createCall[1].body);
            expect(body.config).toEqual({ rewrites: [{ glob: '**', function: 'server' }] });
        });

        it('should populate files with merged hash map (existing + new)', async () => {
            setupHappyPathFetch();
            await deployFileToHosting('my-site', '/test.html', TEST_CONTENT, 'arc_articles', 'doc1');

            const populateCall = mockFetch.mock.calls[4];
            expect(populateCall[0]).toContain(':populateFiles');
            const body = JSON.parse(populateCall[1].body);
            expect(body.files['/existing/page.html']).toBe('existing-hash-123');
            expect(body.files['/test.html']).toBe(TEST_HASH);
        });

        it('should upload gzipped content when hash is in uploadRequiredHashes', async () => {
            setupHappyPathFetch({ uploadRequired: true });
            await deployFileToHosting('my-site', '/test.html', TEST_CONTENT, 'arc_articles', 'doc1');

            const uploadCall = mockFetch.mock.calls[5];
            expect(uploadCall[0]).toBe(`https://upload.example.com/upload/${TEST_HASH}`);
            expect(uploadCall[1].method).toBe('POST');
            expect(uploadCall[1].headers['Content-Type']).toBe('application/octet-stream');
        });

        it('should skip upload when hash is NOT in uploadRequiredHashes', async () => {
            setupHappyPathFetch({ uploadRequired: false });
            await deployFileToHosting('my-site', '/test.html', TEST_CONTENT, 'arc_articles', 'doc1');

            // When upload is not required, Step 8 is skipped.
            // Call 5 should be the finalize PATCH, not an upload POST.
            const call5 = mockFetch.mock.calls[5];
            expect(call5[0]).toContain('?updateMask=status');
            expect(call5[1].method).toBe('PATCH');
        });

        it('should finalize and release the version', async () => {
            setupHappyPathFetch();
            await deployFileToHosting('my-site', '/test.html', TEST_CONTENT, 'arc_articles', 'doc1');

            const calls = mockFetch.mock.calls;
            // Finalize (step 9a) — call index 6 when upload is required
            const finalizeCall = calls[6];
            expect(finalizeCall[0]).toContain('?updateMask=status');
            expect(JSON.parse(finalizeCall[1].body)).toEqual({ status: 'FINALIZED' });
            // Release (step 9b)
            const releaseCall = calls[7];
            expect(releaseCall[0]).toContain('/releases?versionName=');
        });

        it('should update content doc with deployStatus=deployed', async () => {
            setupHappyPathFetch();
            await deployFileToHosting('my-site', '/test.html', TEST_CONTENT, 'arc_articles', 'doc1');

            expect(mockCollection).toHaveBeenCalledWith('arc_articles');
            expect(mockInnerDoc).toHaveBeenCalledWith('doc1');
            expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
                deployStatus: 'deployed',
                deployError: '',
                deployErrorCode: '',
                deployedUrl: '/test',
            }));
        });

        it('should write DeploymentLog to subcollection with status=success', async () => {
            setupHappyPathFetch();
            await deployFileToHosting('my-site', '/test.html', TEST_CONTENT, 'arc_articles', 'doc1');

            expect(mockSubCollection).toHaveBeenCalledWith('DeploymentLogs');
            expect(mockSubCollectionAdd).toHaveBeenCalledWith(expect.objectContaining({
                status: 'success',
                filePath: '/test.html',
                error: null,
            }));
            // Verify steps array has 10 entries
            const logArg = mockSubCollectionAdd.mock.calls[0][0];
            expect(logArg.steps.length).toBe(10);
        });
    });

    describe('error handling', () => {
        it('should write deployStatus=failed when auth fails', async () => {
            mockGetClient.mockRejectedValueOnce(new Error('Auth broken'));
            await deployFileToHosting('my-site', '/test.html', TEST_CONTENT, 'arc_articles', 'doc1');

            expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
                deployStatus: 'failed',
                deployErrorCode: 'HOSTING_AUTH_FAILED',
            }));
        });

        it('should write HOSTING_API_403 when API returns 403', async () => {
            mockFetch
                // Step 2: GET releases returns 403
                .mockResolvedValueOnce(jsonResponse(
                    { error: { code: 403, message: 'Permission denied' } },
                    false,
                    403,
                ));

            await deployFileToHosting('my-site', '/test.html', TEST_CONTENT, 'arc_articles', 'doc1');

            expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
                deployStatus: 'failed',
                deployErrorCode: 'HOSTING_API_403',
            }));
        });

        it('should always write DeploymentLog even on failure', async () => {
            mockGetClient.mockRejectedValueOnce(new Error('Auth broken'));
            await deployFileToHosting('my-site', '/test.html', TEST_CONTENT, 'arc_articles', 'doc1');

            expect(mockSubCollectionAdd).toHaveBeenCalledWith(expect.objectContaining({
                status: 'failed',
                error: expect.stringContaining('Auth broken'),
            }));
        });

        it('should record the failed step in the steps array', async () => {
            mockGetClient.mockRejectedValueOnce(new Error('Auth broken'));
            await deployFileToHosting('my-site', '/test.html', TEST_CONTENT, 'arc_articles', 'doc1');

            const logArg = mockSubCollectionAdd.mock.calls[0][0];
            const failedStep = logArg.steps.find((s: any) => s.status === 'failed');
            expect(failedStep).toBeDefined();
            expect(failedStep.error).toContain('Auth broken');
        });

        it('should default siteId to process.env.GCLOUD_PROJECT', async () => {
            setupHappyPathFetch();
            await deployFileToHosting('', '/test.html', TEST_CONTENT, 'arc_articles', 'doc1');

            const firstCall = mockFetch.mock.calls[0][0];
            expect(firstCall).toContain('/sites/test-project/');
        });

        it('should handle first deployment (no existing releases) with empty file map', async () => {
            mockFetch
                // Step 2: GET releases — empty
                .mockResolvedValueOnce(jsonResponse({ releases: [] }))
                // Step 6: Create version (no files/config fetch since no current version)
                .mockResolvedValueOnce(jsonResponse({ name: 'sites/my-site/versions/v-first' }))
                // Step 7: Populate files
                .mockResolvedValueOnce(jsonResponse({
                    uploadRequiredHashes: [TEST_HASH],
                    uploadUrl: 'https://upload.example.com/upload',
                }))
                // Step 8: Upload
                .mockResolvedValueOnce(jsonResponse({}))
                // Step 9a: Finalize
                .mockResolvedValueOnce(jsonResponse({ status: 'FINALIZED' }))
                // Step 9b: Release
                .mockResolvedValueOnce(jsonResponse({}));

            await deployFileToHosting('my-site', '/test.html', TEST_CONTENT, 'arc_articles', 'doc1');

            expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
                deployStatus: 'deployed',
            }));
            // Populate should only have our new file (call index 2 since steps 3+4 skipped)
            const populateCall = mockFetch.mock.calls[2];
            const body = JSON.parse(populateCall[1].body);
            expect(Object.keys(body.files)).toEqual(['/test.html']);
        });
    });
});

describe('removeFileFromHosting', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        restoreMockImplementations();
        process.env.GCLOUD_PROJECT = 'test-project';
    });

    it('should remove target file and create new version without it', async () => {
        mockFetch
            // GET releases
            .mockResolvedValueOnce(jsonResponse({
                releases: [{ version: { name: 'sites/s/versions/v1' } }],
            }))
            // GET files
            .mockResolvedValueOnce(jsonResponse({
                files: [
                    { path: '/articles/post1.html', hash: 'h1' },
                    { path: '/articles/post2.html', hash: 'h2' },
                ],
            }))
            // GET config
            .mockResolvedValueOnce(jsonResponse({ config: { headers: [] } }))
            // POST create version
            .mockResolvedValueOnce(jsonResponse({ name: 'sites/s/versions/v2' }))
            // POST populate
            .mockResolvedValueOnce(jsonResponse({ uploadRequiredHashes: [] }))
            // PATCH finalize
            .mockResolvedValueOnce(jsonResponse({}))
            // POST release
            .mockResolvedValueOnce(jsonResponse({}));

        await removeFileFromHosting('s', '/articles/post1.html');

        // Verify populate call only has post2
        const populateCall = mockFetch.mock.calls[4];
        const body = JSON.parse(populateCall[1].body);
        expect(body.files).toEqual({ '/articles/post2.html': 'h2' });
    });

    it('should skip gracefully when file is not in current version', async () => {
        mockFetch
            // GET releases
            .mockResolvedValueOnce(jsonResponse({
                releases: [{ version: { name: 'sites/s/versions/v1' } }],
            }))
            // GET files (doesn't include the target)
            .mockResolvedValueOnce(jsonResponse({
                files: [{ path: '/other.html', hash: 'h1' }],
            }));

        await removeFileFromHosting('s', '/nonexistent.html');

        // Should only make 2 calls (releases + files), then return
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should preserve hosting config during removal', async () => {
        mockFetch
            .mockResolvedValueOnce(jsonResponse({
                releases: [{ version: { name: 'sites/s/versions/v1' } }],
            }))
            .mockResolvedValueOnce(jsonResponse({
                files: [{ path: '/test.html', hash: 'h1' }],
            }))
            .mockResolvedValueOnce(jsonResponse({
                config: { rewrites: [{ glob: '/admin/**', function: 'server' }] },
            }))
            .mockResolvedValueOnce(jsonResponse({ name: 'sites/s/versions/v2' }))
            .mockResolvedValueOnce(jsonResponse({ uploadRequiredHashes: [] }))
            .mockResolvedValueOnce(jsonResponse({}))
            .mockResolvedValueOnce(jsonResponse({}));

        await removeFileFromHosting('s', '/test.html');

        const createCall = mockFetch.mock.calls[3];
        const body = JSON.parse(createCall[1].body);
        expect(body.config).toEqual({
            rewrites: [{ glob: '/admin/**', function: 'server' }],
        });
    });

    it('should default siteId to process.env.GCLOUD_PROJECT', async () => {
        mockFetch
            .mockResolvedValueOnce(jsonResponse({
                releases: [{ version: { name: 'sites/test-project/versions/v1' } }],
            }))
            .mockResolvedValueOnce(jsonResponse({
                files: [{ path: '/test.html', hash: 'h1' }],
            }))
            .mockResolvedValueOnce(jsonResponse({ config: {} }))
            .mockResolvedValueOnce(jsonResponse({ name: 'sites/test-project/versions/v2' }))
            .mockResolvedValueOnce(jsonResponse({ uploadRequiredHashes: [] }))
            .mockResolvedValueOnce(jsonResponse({}))
            .mockResolvedValueOnce(jsonResponse({}));

        await removeFileFromHosting('', '/test.html');

        const firstCall = mockFetch.mock.calls[0][0];
        expect(firstCall).toContain('/sites/test-project/');
    });
});
