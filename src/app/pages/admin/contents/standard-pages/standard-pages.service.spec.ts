/**
 * Creating the standard pages (specs/site-sections-spec.md, SS6): only what is
 * missing, never over an admin's own /info type.
 */
import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state, mockSetDoc, mockUpdateDoc } = vi.hoisted(() => ({
    state: { type: null as Record<string, unknown> | null, drafts: [] as string[], about: {} as Record<string, unknown> },
    mockSetDoc: vi.fn(),
    mockUpdateDoc: vi.fn(),
}));
vi.mock('@angular/fire/firestore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@angular/fire/firestore')>()),
    collection: vi.fn((_fs: unknown, path: string) => ({ path })),
    doc: vi.fn((parent: { path: string } | unknown, ...segments: string[]) => ({
        path: [typeof parent === 'object' && parent && 'path' in parent ? (parent as { path: string }).path : '', ...segments].filter(Boolean).join('/'),
        id: segments[segments.length - 1],
    })),
    where: vi.fn((field: string, _op: string, value: unknown) => ({ field, value })),
    limit: vi.fn(() => ({})),
    query: vi.fn((ref: { path: string }, w: { field: string; value: unknown }) => ({ path: ref.path, where: w })),
    getDocs: vi.fn(async (q: { path: string; where: { value: unknown } }) => {
        if (q.path === 'ContentTypes') return { docs: state.type ? [{ id: 'info', data: () => state.type }] : [] };
        return { empty: !state.drafts.includes(String(q.where.value)), docs: [] };
    }),
    getDoc: vi.fn(async () => ({ data: () => state.about })),
    setDoc: (...a: unknown[]) => mockSetDoc(...a),
    updateDoc: (...a: unknown[]) => mockUpdateDoc(...a),
    serverTimestamp: () => 'now',
}));
vi.mock('../../../../core/features/features', () => ({ isOn: () => true }));

import { StandardPagesService } from './standard-pages.service';
import { standardPagesFields } from './standard-pages';

describe('StandardPagesService', () => {
    let service: StandardPagesService;
    const written = () => mockSetDoc.mock.calls.map(([ref, data]) => ({ path: ref.path, data }));

    beforeEach(() => {
        vi.clearAllMocks();
        mockSetDoc.mockResolvedValue(undefined);
        mockUpdateDoc.mockResolvedValue(undefined);
        state.type = null;
        state.drafts = [];
        state.about = { name: 'Kumar Studio' };
        TestBed.configureTestingModule({ providers: [{ provide: Firestore, useValue: {} }] });
        service = TestBed.inject(StandardPagesService);
    });

    it('creates the Info Pages type and six drafts in footer order on a site without them', async () => {
        const result = await service.ensure();
        expect(result).toEqual({ createdType: true, createdPages: ['about', 'contact', 'faq', 'privacy-policy', 'terms', 'cookie-policy'], addedFields: [], foreignType: false });
        const [type, ...pages] = written();
        expect(type.path).toBe('ContentTypes/info');
        expect(type.data).toMatchObject({ slug: 'info', standard: 'pages', createdBy: 'system' });
        expect(pages.map((p) => [p.path, p.data['status'], p.data['sortOrder']])).toEqual([
            ['arc_info_drafts/about', 'draft', 1], ['arc_info_drafts/contact', 'draft', 2], ['arc_info_drafts/faq', 'draft', 3],
            ['arc_info_drafts/privacy-policy', 'draft', 4], ['arc_info_drafts/terms', 'draft', 5], ['arc_info_drafts/cookie-policy', 'draft', 6],
        ]);
        expect(pages[0].data['content']).toContain('Kumar Studio');
        // SS8: Contact starts in the Contact layout; the others in the folder's detail.html.
        expect(pages.map((p) => p.data['layout'])).toEqual(['', 'contact', '', '', '', '']);
        expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    it('adds only the missing pages to an existing Info Pages type, after the ones there', async () => {
        state.type = { slug: 'info', standard: 'pages', fields: standardPagesFields(true) };
        state.drafts = ['about', 'contact', 'faq', 'privacy-policy', 'terms'];
        const result = await service.ensure();
        expect(result).toEqual({ createdType: false, createdPages: ['cookie-policy'], addedFields: [], foreignType: false });
        expect(mockUpdateDoc).not.toHaveBeenCalled();
        expect(written()).toHaveLength(1);
        expect(written()[0].data['sortOrder']).toBeUndefined();
    });

    it('leaves an admin\'s own /info type alone', async () => {
        state.type = { slug: 'info', name: 'Information' };
        expect(await service.ensure()).toEqual({ createdType: false, createdPages: [], addedFields: [], foreignType: true });
        expect(mockSetDoc).not.toHaveBeenCalled();
        expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    // SS8: an Info Pages type from before Info boxes gets the field, after its own, once.
    it('adds the standard fields an older Info Pages type lacks, keeping every field it has', async () => {
        const older = standardPagesFields(true).filter((f) => f.key !== 'info-info-boxes');
        const own = { key: 'info-hours', label: 'Hours', type: 'text', required: false, order: 7 };
        state.type = { slug: 'info', standard: 'pages', fields: [...older, own] };
        state.drafts = ['about', 'contact', 'faq', 'privacy-policy', 'terms', 'cookie-policy'];
        const result = await service.ensure();
        expect(result).toEqual({ createdType: false, createdPages: [], addedFields: ['Info boxes'], foreignType: false });
        const [ref, data] = mockUpdateDoc.mock.calls[0];
        expect(ref.path).toBe('ContentTypes/info');
        expect(data.fields.map((f: { key: string; order: number }) => [f.key, f.order])).toEqual([
            ...older.map((f) => [f.key, f.order]), ['info-hours', 7], ['info-info-boxes', 8],
        ]);
        expect(mockSetDoc).not.toHaveBeenCalled();
    });
});
