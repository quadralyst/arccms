/**
 * The button on a content list: createContentListIndexes, and the admin API calls behind it
 * (functions/src/content-types/contentListIndexes.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockTypes } = vi.hoisted(() => ({ mockTypes: vi.fn() }));

vi.mock('../init', () => ({
  db: { collection: vi.fn(() => ({ where: () => ({ limit: () => ({ get: mockTypes }) }) })) },
}));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((handler: any) => handler),
  HttpsError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    getAccessToken = async () => 'token';
  },
}));

import { createContentListIndexes } from '../content-types/createContentListIndexes.js';
import { deleteContentListIndexes } from '../content-types/contentListIndexes.js';

const handler = createContentListIndexes as unknown as (r: any) => Promise<any>;
const admin = (data: any) => ({ auth: { token: { arccms_role: 'admin' } }, data });
const answer = (status: number, body: unknown = {}) => ({ ok: status < 300, status, text: async () => JSON.stringify(body), json: async () => body });

describe('createContentListIndexes', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('GCLOUD_PROJECT', 'demo-project');
    mockTypes.mockResolvedValue({ empty: false });
    fetchMock.mockResolvedValue(answer(200));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('refuses anyone but an admin', async () => {
    await expect(handler({ auth: { token: { arccms_role: 'editor' } }, data: { slug: 'articles' } })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a request with no type', async () => {
    await expect(handler(admin({}))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('refuses a type that does not exist, so it cannot index any other collection', async () => {
    mockTypes.mockResolvedValue({ empty: true });
    await expect(handler(admin({ slug: 'users' }))).rejects.toMatchObject({ code: 'not-found' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for both directions on the type's draft collection", async () => {
    await expect(handler(admin({ slug: 'articles' }))).resolves.toEqual({ indexes: 'requested' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/projects/demo-project/databases/');
    expect(url).toContain('/collectionGroups/arc_articles_drafts/indexes');
    expect(init.headers.Authorization).toBe('Bearer token');
    const orders = fetchMock.mock.calls.map(([, call]) => JSON.parse(call.body).fields);
    expect(orders.map((fields) => fields[0])).toEqual([
      { fieldPath: 'publishedStatus', order: 'ASCENDING' },
      { fieldPath: 'publishedStatus', order: 'ASCENDING' },
    ]);
    expect(orders.map((fields) => fields[1].order).sort()).toEqual(['ASCENDING', 'DESCENDING']);
  });

  it('an index that exists already is not a failure', async () => {
    fetchMock.mockResolvedValue(answer(409));
    await expect(handler(admin({ slug: 'articles' }))).resolves.toEqual({ indexes: 'requested' });
  });

  it('answers failed, without throwing, when the account may not create indexes', async () => {
    fetchMock.mockResolvedValue(answer(403, { error: 'denied' }));
    await expect(handler(admin({ slug: 'articles' }))).resolves.toEqual({ indexes: 'failed' });
  });
});

describe('deleteContentListIndexes', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('GCLOUD_PROJECT', 'demo-project');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('deletes only this pair, and leaves an index an app made on the collection', async () => {
    const ours = { name: 'projects/p/x/indexes/1', fields: [{ fieldPath: 'publishedStatus' }, { fieldPath: 'modifiedAt' }, { fieldPath: '__name__' }] };
    const theirs = { name: 'projects/p/x/indexes/2', fields: [{ fieldPath: 'authorId' }, { fieldPath: 'modifiedAt' }, { fieldPath: '__name__' }] };
    fetchMock.mockResolvedValueOnce(answer(200, { indexes: [ours, theirs] })).mockResolvedValue(answer(200));

    await deleteContentListIndexes('arc_articles_drafts');

    const deleted = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([url]) => url);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toContain('indexes/1');
  });

  it('never throws: a type goes whether or not its indexes could', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(deleteContentListIndexes('arc_articles_drafts')).resolves.toBeUndefined();
  });
});
