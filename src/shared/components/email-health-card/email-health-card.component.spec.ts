import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

/** What getDocs answers; a plain function, so a rejection is only the component's to handle. */
let getDocs: () => Promise<unknown> = async () => ({ forEach: () => {} });
vi.mock('@angular/fire/firestore', () => ({
    Firestore: class {},
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    getDocs: () => getDocs(),
    Timestamp: { fromMillis: (ms: number) => ms },
}));

import { Firestore } from '@angular/fire/firestore';
import { EmailHealthCardComponent } from './email-health-card.component';

async function render() {
    TestBed.configureTestingModule({
        imports: [EmailHealthCardComponent],
        providers: [{ provide: Firestore, useValue: {} }],
    });
    const fixture = TestBed.createComponent(EmailHealthCardComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
}

describe('EmailHealthCardComponent', () => {

    it('counts the last day of emails by status', async () => {
        const docs = [{ status: 'success' }, { status: 'success' }, { status: 'failed' }];
        getDocs = async () => ({ forEach: (fn: (d: unknown) => void) => docs.forEach((d) => fn({ data: () => d })) });
        const el = await render();
        expect(el.textContent).toContain('2 sent');
        expect(el.textContent).toContain('1 failed');
        expect(el.textContent).toContain('1 emails failed in the last 24 hours');
    });

    it('says plainly when the counts did not load, with no technical text', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        getDocs = async () => { throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }); };
        const el = await render();
        const alert = el.querySelector('[role="alert"]');
        expect(alert?.textContent).toContain('The email counts did not load.');
        expect(el.textContent).not.toContain('permission');
        expect(el.textContent).not.toContain('0 sent');
    });
});
