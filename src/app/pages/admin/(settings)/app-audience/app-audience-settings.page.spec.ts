import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';
import { Firestore } from '@angular/fire/firestore';

const m = vi.hoisted(() => {
    const responses: Record<string, unknown> = {};
    const calls: Array<{ name: string; data: unknown }> = [];
    return {
        responses,
        calls,
        httpsCallable: vi.fn((_f: unknown, name: string) => async (data: unknown) => {
            calls.push({ name, data });
            return { data: responses[name] };
        }),
        setDoc: vi.fn().mockResolvedValue(undefined),
        doc: vi.fn((_fs: unknown, ...path: string[]) => path.join('/')),
    };
});
vi.mock('@angular/fire/functions', () => ({ Functions: class {}, httpsCallable: m.httpsCallable }));
vi.mock('@angular/fire/firestore', () => ({ Firestore: class {}, doc: m.doc, setDoc: m.setDoc }));

import { AppAudienceSettingsPage } from './app-audience-settings.page';
import { ToastService } from '../../../../../shared/services/toast.service';
import { translocoTestingModule } from '../../../../../test/transloco-test-providers';

const configured = { configured: true, database: '(default)', path: 'users/{uid}', collection: 'users' };

async function open() {
    const fixture = TestBed.createComponent(AppAudienceSettingsPage);
    fixture.detectChanges();
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    return fixture;
}

describe('AppAudienceSettingsPage', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        m.calls.length = 0;
        await TestBed.configureTestingModule({
            imports: [AppAudienceSettingsPage, translocoTestingModule()],
            providers: [
                { provide: Functions, useValue: {} },
                { provide: Firestore, useValue: {} },
                { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
            ],
        }).compileComponents();
    });

    it('explains how to connect a collection when none is configured, and samples nothing', async () => {
        m.responses['arccms-appAudienceStatus'] = {
            location: { configured: false, database: '(default)', path: '_arccms_app_users_not_configured/{id}', collection: '' },
            settings: { key: { source: 'docId' }, watchedFields: [] },
        };
        const fixture = await open();
        expect((fixture.nativeElement as HTMLElement).textContent).toContain('No host collection is configured');
        expect(m.calls.map((c) => c.name)).not.toContain('arccms-sampleAppUsers');
    });

    it('loads the saved settings and the sampled fields', async () => {
        m.responses['arccms-appAudienceStatus'] = {
            location: configured,
            settings: { key: { source: 'field', field: 'phone' }, emailField: 'email', watchedFields: ['plan'] },
        };
        m.responses['arccms-sampleAppUsers'] = {
            sampleSize: 2,
            fields: [{ path: 'email', examples: ['a@x.com'], seenIn: 2 }, { path: 'plan', examples: ['free'], seenIn: 2 }],
        };
        const fixture = await open();
        const page = fixture.componentInstance;
        expect(page.keySource()).toBe('field');
        expect(page.keyField()).toBe('phone');
        expect(page.fields().map((f) => f.path)).toEqual(['email', 'plan']);
        expect((fixture.nativeElement as HTMLElement).textContent).toContain('users/{uid}');
    });

    it('saves exactly the edited settings, without empty optional fields', async () => {
        m.responses['arccms-appAudienceStatus'] = { location: configured, settings: { key: { source: 'docId' }, watchedFields: [] } };
        m.responses['arccms-sampleAppUsers'] = { sampleSize: 0, fields: [] };
        const page = (await open()).componentInstance;
        page.keySource.set('field');
        page.keyField.set('mobile');
        page.nameField.set('profile.name');
        page.toggleWatched('plan');

        await page.save();

        expect(m.setDoc).toHaveBeenCalledWith('Settings/app_audience', {
            key: { source: 'field', field: 'mobile' },
            nameField: 'profile.name',
            watchedFields: ['plan'],
        });
    });

    it('needs the key field chosen before saving a field key', async () => {
        m.responses['arccms-appAudienceStatus'] = { location: configured, settings: { key: { source: 'docId' }, watchedFields: [] } };
        m.responses['arccms-sampleAppUsers'] = { sampleSize: 0, fields: [] };
        const page = (await open()).componentInstance;
        page.keySource.set('field');
        expect(page.canSave()).toBe(false);
    });
});
