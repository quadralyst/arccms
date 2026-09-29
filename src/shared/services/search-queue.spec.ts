import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@angular/fire/firestore', () => ({ doc: vi.fn((_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` })) }));
const off = vi.hoisted(() => new Set<string>());
vi.mock('../../app/core/features/features', () => ({ isOn: (id: string) => !off.has(id) }));

import { draftQueueEntry, SEARCH_QUEUE_COLLECTION } from './search-queue';

const db = {} as never;

describe('draftQueueEntry', () => {
    beforeEach(() => off.clear());

    it('queues a draft, and a draft translation, under one entry per draft', () => {
        const entry = draftQueueEntry(db, 'arc_blog_drafts/d1');
        expect(entry?.ref).toEqual({ path: `${SEARCH_QUEUE_COLLECTION}/arc_blog_drafts~d1` });
        expect(entry?.data).toMatchObject({ collection: 'arc_blog_drafts', docId: 'd1' });
        expect(draftQueueEntry(db, 'arc_blog_drafts/d1/translations/hi')?.ref).toEqual(entry?.ref);
    });

    it('queues nothing else', () => {
        expect(draftQueueEntry(db, 'arc_blog/p1')).toBeNull();
        expect(draftQueueEntry(db, 'users/u1')).toBeNull();
        expect(draftQueueEntry(db, 'arc_blog_drafts')).toBeNull();
    });

    it('queues nothing without search or without content', () => {
        off.add('search');
        expect(draftQueueEntry(db, 'arc_blog_drafts/d1')).toBeNull();
        off.clear();
        off.add('content');
        expect(draftQueueEntry(db, 'arc_blog_drafts/d1')).toBeNull();
    });
});

describe('draft writers', () => {
    const read = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf8');

    it('queue in every write path of the shared database service', () => {
        const source = read('src/shared/services/db.service.ts');
        for (const method of ['add(', 'update(', 'addBatch(', 'delete(']) {
            const start = source.indexOf(`\n    ${method}`);
            const end = source.indexOf('\n    }\n', start);
            expect(source.slice(start, end), method).toContain('this.queueForSearch(');
        }
    });

    it('queue translation saves and deletes', () => {
        const source = read('src/app/pages/admin/contents/draft-content-store/draft-contents.service.ts');
        expect(source.match(/draftQueueEntry\(this\.firestore, ref\.path\)/g)).toHaveLength(2);
    });
});
