import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Functions } from '@angular/fire/functions';

const m = vi.hoisted(() => {
    const responses: Record<string, unknown> = {};
    const calls: Array<{ name: string; data: unknown }> = [];
    return {
        responses,
        calls,
        httpsCallable: vi.fn((_f: unknown, name: string) => async (data: unknown) => {
            calls.push({ name, data });
            const r = responses[name];
            if (r instanceof Error) throw r;
            return { data: r };
        }),
    };
});
vi.mock('@angular/fire/functions', () => ({ Functions: class {}, httpsCallable: m.httpsCallable }));

import AppUsersPageComponent, { AppUserRow } from './app-users.page';
import { headerTestProviders } from '../../../../test/header-test-providers';
import { translocoTestingModule } from '../../../../test/transloco-test-providers';

const row = (docId: string, name: string, email: string): AppUserRow =>
    ({ docId, key: email, email, phone: '', name, consent: 'subscribed' });

async function open() {
    const fixture = TestBed.createComponent(AppUsersPageComponent);
    fixture.detectChanges();
    await fixture.componentInstance.load();
    fixture.detectChanges();
    return fixture;
}

describe('AppUsersPage', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        m.calls.length = 0;
        for (const k of Object.keys(m.responses)) delete m.responses[k];
        await TestBed.configureTestingModule({
            imports: [AppUsersPageComponent, translocoTestingModule()],
            providers: [...headerTestProviders(), provideRouter([]), provideNoopAnimations(), { provide: Functions, useValue: {} }],
        }).compileComponents();
    });

    it('points to Settings and lists nothing when no app is connected', async () => {
        m.responses['arccms-appAudienceStatus'] = { location: { configured: false, path: '' } };
        const fixture = await open();
        const text = (fixture.nativeElement as HTMLElement).textContent;
        expect(text).toContain('No app is connected yet');
        expect(m.calls.map((c) => c.name)).not.toContain('arccms-listAppUsers');
    });

    it('lists app users live and filters them in the browser', async () => {
        m.responses['arccms-appAudienceStatus'] = { location: { configured: true, path: 'users/{id}' } };
        m.responses['arccms-listAppUsers'] = {
            rows: [row('a', 'Amy', 'amy@x.com'), row('b', 'Zed', 'zed@x.com')],
            scanned: 3, withoutKey: 1, truncated: false,
        };
        const fixture = await open();
        const page = fixture.componentInstance;
        expect(page.total()).toBe(2);
        expect((fixture.nativeElement as HTMLElement).textContent).toContain('1 documents have no value');

        const listCalls = () => m.calls.filter((c) => c.name === 'arccms-listAppUsers').length;
        const before = listCalls();
        page.onSearch('ZED');
        expect(page.filtered().map((r) => r.docId)).toEqual(['b']);
        expect(listCalls()).toBe(before);
    });

    it('says when the audience is the site\'s own users (CO6.8)', async () => {
        m.responses['arccms-appAudienceStatus'] = { location: { configured: true, path: 'users/{id}', own: true } };
        m.responses['arccms-listAppUsers'] = { rows: [], scanned: 0, withoutKey: 0, truncated: false };
        const fixture = await open();
        expect((fixture.nativeElement as HTMLElement).textContent).toContain("This site's own users, read live.");
    });

    it('says in a plain sentence when the list cannot be read, with Retry, never the server\'s text', async () => {
        m.responses['arccms-appAudienceStatus'] = { location: { configured: true, path: 'users/{id}' } };
        m.responses['arccms-listAppUsers'] = new Error('permission-denied');
        const fixture = await open();
        const el = fixture.nativeElement as HTMLElement;
        expect(el.textContent).toContain("Your app's users did not load.");
        expect(el.textContent).not.toContain('permission-denied');
        const retry = [...el.querySelectorAll('button')].find((b) => /Retry/.test(b.textContent ?? ''));
        expect(retry).toBeTruthy();
        m.responses['arccms-listAppUsers'] = { rows: [row('a', 'Amy', 'amy@x.com')], scanned: 1, withoutKey: 0, truncated: false };
        retry!.click();
        await new Promise((r) => setTimeout(r));
        fixture.detectChanges();
        expect(fixture.componentInstance.error()).toBe('');
        expect(fixture.componentInstance.total()).toBe(1);
    });

    it('says Nothing matches for a search with no rows, and Clear filters empties the search', async () => {
        m.responses['arccms-appAudienceStatus'] = { location: { configured: true, path: 'users/{id}' } };
        m.responses['arccms-listAppUsers'] = { rows: [row('a', 'Amy', 'amy@x.com')], scanned: 1, withoutKey: 0, truncated: false };
        const fixture = await open();
        fixture.componentInstance.onSearch('nobody');
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        expect(el.textContent).toContain('Nothing matches');
        [...el.querySelectorAll('button')].find((b) => /Clear filters/.test(b.textContent ?? ''))!.click();
        expect(fixture.componentInstance.search()).toBe('');
    });

    it('shows the consent in the admin\'s language, and a plain sentence when one user cannot be read', async () => {
        m.responses['arccms-appAudienceStatus'] = { location: { configured: true, path: 'users/{id}' } };
        m.responses['arccms-listAppUsers'] = { rows: [row('a', 'Amy', 'amy@x.com')], scanned: 1, withoutKey: 0, truncated: false };
        const fixture = await open();
        const consent = fixture.componentInstance.columns.find((c) => c.key === 'consent')!;
        expect(consent.transformFn!(row('a', 'Amy', 'amy@x.com'))).toContain('>Subscribed<');
        m.responses['arccms-getAppUser'] = new Error('internal');
        await fixture.componentInstance.openDetail(row('a', 'Amy', 'amy@x.com'));
        fixture.detectChanges();
        expect((fixture.nativeElement as HTMLElement).textContent).toContain("This user's details did not load.");
    });

    it('opens one person with every field from the app', async () => {
        m.responses['arccms-appAudienceStatus'] = { location: { configured: true, path: 'users/{id}' } };
        m.responses['arccms-listAppUsers'] = { rows: [row('a', 'Amy', 'amy@x.com')], scanned: 1, withoutKey: 0, truncated: false };
        m.responses['arccms-getAppUser'] = {
            person: { docId: 'a', key: 'amy@x.com', email: 'amy@x.com', phone: '', name: 'Amy' },
            fields: { plan: 'paid', email: 'amy@x.com' },
            state: { consent: 'subscribed' },
            activity: [{ id: 'e1', type: 'app_user.changed.isPro', at: '2026-09-24T10:00:00.000Z', field: 'isPro', from: 'false', to: 'true', status: 'no_mapping' }],
        };
        const fixture = await open();
        await fixture.componentInstance.openDetail(row('a', 'Amy', 'amy@x.com'));
        expect(m.calls.find((c) => c.name === 'arccms-getAppUser')?.data).toEqual({ docId: 'a' });
        expect(fixture.componentInstance.detailFields()).toEqual([['email', 'amy@x.com'], ['plan', 'paid']]);
        fixture.detectChanges();
        const text = (fixture.nativeElement as HTMLElement).textContent;
        expect(text).toContain('false → true');
        expect(text).toContain('No rule set up for this event');
    });

    it('has the limit warning in every language, with the limit filled in (RF5)', async () => {
        const { APP_USERS_LIMIT_NOTE_KEY, APP_USERS_LIMIT_PARAMS } = await import('./app-users-limit');
        const { readFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        for (const lang of ['en', 'hi']) {
            const json = JSON.parse(readFileSync(join(__dirname, `../../../../assets/i18n/${lang}.json`), 'utf8'));
            const text = APP_USERS_LIMIT_NOTE_KEY.split('.').reduce((o: any, k) => o?.[k], json);
            expect(text, lang).toContain('{{ max }}');
        }
        expect(APP_USERS_LIMIT_PARAMS.max).toBe('2,000');
    });
});
