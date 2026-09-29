import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Firestore } from '@angular/fire/firestore';
import { SearchSettingsPage, guessSetup } from './search-settings.page';
import { SearchService } from '../../../../core/services/search.service';
import type { SearchCollectionRow } from '../../../../../shared/models/search.model';

const { getDocMock, setDocMock } = vi.hoisted(() => ({ getDocMock: vi.fn(), setDocMock: vi.fn() }));
vi.mock('@angular/fire/firestore', async () => {
    const actual = await vi.importActual<typeof import('@angular/fire/firestore')>('@angular/fire/firestore');
    return {
        ...actual,
        doc: vi.fn((_db: unknown, _c: string, id: string) => ({ id })),
        getDoc: (...args: unknown[]) => getDocMock(...args),
        setDoc: (...args: unknown[]) => setDocMock(...args),
    };
});

const LESSONS_SETUP = { label: 'Lessons', fields: [{ path: 'title', weight: 'high' as const }], title: 'title', scope: 'admin' as const };

const COLLECTIONS: SearchCollectionRow[] = [
    { name: 'arc_blog_drafts', state: 'content', sourceId: 'content-drafts' },
    { name: 'EmailLogs', state: 'refused', reason: 'one document per email sent' },
    { name: 'Lessons', state: 'searchable', sourceId: 'collection-Lessons', label: 'Lessons', setup: LESSONS_SETUP },
    { name: 'Products', state: 'code', sourceId: 'products', label: 'Products' },
    { name: 'Quizzes', state: 'needs_setup', sourceId: 'collection-Quizzes' },
    { name: 'users', state: 'not_listed' },
];

describe('SearchSettingsPage', () => {
    let fixture: ComponentFixture<SearchSettingsPage>;
    let component: SearchSettingsPage;
    let searchMock: { reindex: ReturnType<typeof vi.fn>; listCollections: ReturnType<typeof vi.fn>; sampleFields: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        getDocMock.mockImplementation(async (ref: { id: string }) => ref.id === 'search_status'
            ? {
                exists: () => true,
                data: () => ({
                    sources: {
                        content: { documents: 3, entries: 4, reindexedAt: { seconds: 1_700_000_000 } },
                        'collection-Lessons': { label: 'Lessons', scope: 'admin', documents: 2, entries: 2 },
                    },
                }),
            }
            : { exists: () => true, data: () => ({ collections: { Lessons: LESSONS_SETUP } }) });
        setDocMock.mockReset().mockResolvedValue(undefined);
        searchMock = {
            reindex: vi.fn().mockResolvedValue([{ source: 'content', documents: 3, entries: 4, removed: 0, collections: [], durationMs: 5 }]),
            listCollections: vi.fn().mockResolvedValue({
                collections: COLLECTIONS,
                fields: {
                    content: { fields: null, byType: [{ type: 'Articles', fields: [{ path: 'title', high: true }, { path: 'customFields.city', high: false }] }] },
                    'content-drafts': { fields: null, byType: [] },
                    'collection-Lessons': { fields: [{ path: 'title', high: true }] },
                    products: { fields: null },
                },
            }),
            sampleFields: vi.fn().mockResolvedValue({
                fields: [{ path: 'slug', count: 3, example: 'fractions' }, { path: 'name', count: 3, example: 'Fractions' }, { path: 'summary', count: 2, example: 'Halves' }],
                samples: [{ id: 'q1', values: { name: 'Fractions', summary: 'Halves', slug: 'fractions' } }],
            }),
        };

        await TestBed.configureTestingModule({
            imports: [SearchSettingsPage],
            providers: [
                { provide: Firestore, useValue: {} },
                { provide: SearchService, useValue: searchMock },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SearchSettingsPage);
        component = fixture.componentInstance;
        await component.ngOnInit();
        fixture.detectChanges();
    });

    it('lists content, then the set-up and code sources, with their status', () => {
        expect(component.sourceRows().map(r => r.id)).toEqual(['content', 'content-drafts', 'collection-Lessons', 'products']);
        const content = component.sourceRows()[0];
        expect(content.status?.entries).toBe(4);
        expect(component.reindexedAt(content.status)?.getTime()).toBe(1_700_000_000_000);
        expect(component.sourceRows()[2]).toMatchObject({ label: 'Lessons', scope: 'admin', collection: 'Lessons' });
        expect(component.sourceRows()[3].collection).toBeUndefined();
    });

    it('shows what each source tokenizes, the high fields bold', () => {
        const lines = [...fixture.nativeElement.querySelectorAll('[data-testid="source-fields"]')].map((el: Element) => el.textContent!.replace(/\s+/g, ' ').trim());
        expect(lines).toEqual(['Articles: title, customFields.city', 'No content types yet', 'title', 'Fields set in code']);
        expect(fixture.nativeElement.querySelector('[data-testid="source-fields"] .fw-semibold').textContent).toBe('title');
    });

    it('sets up a collection not named yet, and saves it to wait for the deploy', async () => {
        await component.openEditor('users');
        await component.save();
        expect(setDocMock).toHaveBeenCalled();
        expect(searchMock.reindex).not.toHaveBeenCalled();
        expect(component.message()).toContain('SEARCH_COLLECTIONS');
    });

    it("lists every collection but content's own, the ones to act on first", () => {
        expect(component.collectionRows().map(r => r.name)).toEqual(['Quizzes', 'Lessons', 'Products', 'users', 'EmailLogs']);
        const text = fixture.nativeElement.textContent;
        expect(text).toContain('Never searchable');
        expect(text).toContain('one document per email sent');
    });

    it('prefills a new setup from the sampled fields and previews a real document', async () => {
        await component.openEditor('Quizzes');
        const ed = component.editor()!;
        // Name-like fields ticked high, descriptive ones normal, nothing else (not the commoner slug).
        expect(ed.fields.map(f => [f.path, f.included, f.weight])).toEqual([
            ['slug', false, 'normal'], ['name', true, 'high'], ['summary', true, 'normal'],
        ]);
        expect(ed.title).toBe('name');
        expect(ed.snippet).toBe('summary');

        component.patch({ link: '/quizzes/{slug}' });
        expect(component.preview()).toEqual({ title: 'Fractions', snippet: 'Halves', badge: 'Quizzes', link: '/quizzes/fractions' });
    });

    it('guesses title and snippet from field names, and ticks nothing technical', () => {
        const feedback = guessSetup(['device.language', 'device.platform', 'page.path', 'page.title', 'sender.email', 'sender.name', 'message', 'uid']);
        expect(feedback.title).toBe('page.title');
        expect(feedback.snippet).toBe('message');
        expect([...feedback.ticked.keys()]).toEqual(['page.title', 'sender.name', 'message']);
        expect(guessSetup(['uid', 'createdAt']).ticked.size).toBe(0);
        expect(guessSetup(['description', 'notes'])).toMatchObject({ title: 'description', snippet: 'notes' });
    });

    it('saves the setup whole, then rebuilds that collection', async () => {
        await component.openEditor('Quizzes');
        component.setField(2, { included: false });
        await component.save();

        const written = setDocMock.mock.calls[0][1] as { collections: Record<string, unknown> };
        expect(written.collections['Lessons']).toEqual(LESSONS_SETUP);
        expect(written.collections['Quizzes']).toEqual({ fields: [{ path: 'name', weight: 'high' }], title: 'name', snippet: 'summary', scope: 'admin' });
        expect(searchMock.reindex).toHaveBeenCalledWith({ source: 'collection-Quizzes' });
        expect(component.editor()).toBeNull();
    });

    it('refuses a setup with no field or no title', async () => {
        await component.openEditor('Quizzes');
        component.patch({ title: '' });
        await component.save();
        expect(setDocMock).not.toHaveBeenCalled();
        expect(component.editorError()).toBeTruthy();
    });

    it('opens an existing setup as saved', async () => {
        await component.openEditor('Lessons');
        const ed = component.editor()!;
        // `title` was saved but is not in this sample: it stays, ticked.
        expect(ed.fields.find(f => f.path === 'title')).toMatchObject({ included: true, weight: 'high' });
        expect(ed.fields.find(f => f.path === 'name')?.included).toBe(false);
        expect(ed.scope).toBe('admin');
    });

    it('rebuilds one source or everything, and surfaces failures', async () => {
        await component.rebuild('content');
        expect(searchMock.reindex).toHaveBeenCalledWith({ source: 'content' });
        expect(component.message()).toContain('4');

        searchMock.reindex.mockRejectedValueOnce(new Error('nope'));
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await component.rebuild();
        expect(searchMock.reindex).toHaveBeenCalledWith({});
        expect(component.error()).toBeTruthy();
        spy.mockRestore();
    });
});
