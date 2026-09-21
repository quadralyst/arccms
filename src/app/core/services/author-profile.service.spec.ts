/**
 * Tests for AuthorProfileService (docs/discoverability-spec.md, D2)
 */
import { TestBed } from '@angular/core/testing';
import { Firestore, getDoc } from '@angular/fire/firestore';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { AuthorProfileService } from './author-profile.service';

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class { },
    doc: vi.fn((_db: unknown, col: string, id: string) => ({ path: `${col}/${id}` })),
    getDoc: vi.fn(),
}));

function snapshot(data: unknown | null) {
    return { exists: () => data !== null, data: () => data };
}

describe('AuthorProfileService', () => {
    let service: AuthorProfileService;

    beforeEach(() => {
        vi.clearAllMocks();
        TestBed.configureTestingModule({
            providers: [AuthorProfileService, { provide: Firestore, useValue: {} }],
        });
        service = TestBed.inject(AuthorProfileService);
    });

    it('resolves null for a blank id without reading', async () => {
        expect(await service.load('')).toBeNull();
        expect(await service.load(null)).toBeNull();
        expect(getDoc).not.toHaveBeenCalled();
    });

    it('normalises the document and attaches the id', async () => {
        vi.mocked(getDoc).mockResolvedValue(snapshot({ name: ' Jane ', sameAs: ['https://x.com/jane', 'junk'] }) as any);
        const author = await service.load('a1');
        expect(author).toEqual(expect.objectContaining({ id: 'a1', name: 'Jane', slug: 'jane', sameAs: ['https://x.com/jane'] }));
    });

    it('caches per id and shares in-flight loads', async () => {
        vi.mocked(getDoc).mockResolvedValue(snapshot({ name: 'Jane' }) as any);
        await Promise.all([service.load('a1'), service.load('a1')]);
        await service.load('a1');
        expect(getDoc).toHaveBeenCalledTimes(1);
    });

    it('returns null for a missing document or a nameless one', async () => {
        vi.mocked(getDoc).mockResolvedValueOnce(snapshot(null) as any);
        expect(await service.load('missing')).toBeNull();
        vi.mocked(getDoc).mockResolvedValueOnce(snapshot({ bio: 'no name' }) as any);
        expect(await service.load('nameless')).toBeNull();
    });

    it('returns null on a failed read and does not cache the failure', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(getDoc).mockRejectedValueOnce(new Error('denied'));
        expect(await service.load('a1')).toBeNull();
        vi.mocked(getDoc).mockResolvedValueOnce(snapshot({ name: 'Jane' }) as any);
        expect((await service.load('a1'))?.name).toBe('Jane');
        errorSpy.mockRestore();
    });
});
