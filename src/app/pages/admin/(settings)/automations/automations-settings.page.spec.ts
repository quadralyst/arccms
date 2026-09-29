import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';

const m = vi.hoisted(() => ({
    docs: {} as Record<string, unknown>,
    templates: [] as Array<Record<string, unknown>>,
    setDoc: vi.fn(async () => undefined),
}));
vi.mock('@angular/fire/functions', () => ({
    Functions: class {},
    httpsCallable: vi.fn(() => async () => ({ data: { location: { configured: true }, settings: { watchedFields: ['isPro'] } } })),
}));
vi.mock('@angular/fire/firestore', () => ({
    Firestore: class {},
    doc: (_fs: unknown, ...path: string[]) => path.join('/'),
    collection: (_fs: unknown, name: string) => name,
    getDoc: vi.fn(async (path: string) => ({ data: () => m.docs[path] })),
    getDocs: vi.fn(async () => ({ docs: m.templates.map((t) => ({ data: () => t })) })),
    setDoc: m.setDoc,
}));

import { AutomationsSettingsPage } from './automations-settings.page';
import { AudienceService } from '../../(audience)/audience.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { translocoTestingModule } from '../../../../../test/transloco-test-providers';

async function open() {
    const fixture = TestBed.createComponent(AutomationsSettingsPage);
    fixture.detectChanges();
    await fixture.componentInstance.load();
    fixture.detectChanges();
    return fixture;
}

describe('AutomationsSettingsPage', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        m.docs = {
            'Settings/event_mappings': { mappings: { 'user.signed_up': { enabled: false, addToLists: ['all-users'] } }, note: 'kept' },
            'Settings/notification_types': { types: { announcement: {} } },
        };
        m.templates = [
            { type: 'app_user_upgraded', title: 'Upgraded' },
            { type: 'waitlist_welcome_email', title: 'Welcome A' },
            { type: 'waitlist_welcome_email', title: 'Welcome B' },
        ];
        await TestBed.configureTestingModule({
            imports: [AutomationsSettingsPage, translocoTestingModule()],
            providers: [
                { provide: Firestore, useValue: {} },
                { provide: Functions, useValue: {} },
                { provide: AudienceService, useValue: { getLists: () => of([{ id: 'l1', name: 'News', type: 'manual' }, { id: 'app', name: 'Pros', type: 'app' }]) } },
                { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
            ],
        }).compileComponents();
    });

    it('lists the events, including one per watched app field, with their labels', async () => {
        const fixture = await open();
        const page = fixture.componentInstance;
        expect(page.events().map((e) => e.type)).toContain('app_user.changed.isPro');
        const text = (fixture.nativeElement as HTMLElement).textContent;
        expect(text).toContain('A user signs up');
        expect(text).toContain('isPro changes in your app');
        expect(page.templates().map((t) => t.type)).toEqual(['app_user_upgraded', 'waitlist_welcome_email']);
        expect(page.contactLists().map((l) => l.id)).toEqual(['l1']);
    });

    it('saves one event over a fresh read, keeping other events and fields', async () => {
        const fixture = await open();
        const page = fixture.componentInstance;
        page.addRule('app_user.changed.isPro');
        page.patchRule('app_user.changed.isPro', 0, { name: 'Upgraded', toKind: 'equals', toText: 'true', sendEmail: true, templateType: 'app_user_upgraded' });
        page.patchEvent('app_user.changed.isPro', { enabled: true });
        // Someone switched an event on elsewhere since the page loaded.
        m.docs['Settings/event_mappings'] = { mappings: { 'user.signed_up': { enabled: true, addToLists: ['all-users'] } }, note: 'kept' };
        await page.save('app_user.changed.isPro');
        expect(m.setDoc).toHaveBeenCalledWith('Settings/event_mappings', {
            note: 'kept',
            mappings: {
                'user.signed_up': { enabled: true, addToLists: ['all-users'] },
                'app_user.changed.isPro': {
                    enabled: true,
                    rules: [{ name: 'Upgraded', when: { to: { equals: 'true' } }, sendEmail: { templateType: 'app_user_upgraded', category: 'transactional' } }],
                },
            },
        });
        expect(page.dirty().has('app_user.changed.isPro')).toBe(false);
    });

    it('does not save an event with problems', async () => {
        const fixture = await open();
        const page = fixture.componentInstance;
        page.addRule('user.signed_up');
        expect(page.problems()['user.signed_up']).toContain('rule_needs_action');
        await page.save('user.signed_up');
        expect(m.setDoc).not.toHaveBeenCalled();
    });
});
