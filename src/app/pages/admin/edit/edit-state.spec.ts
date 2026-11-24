/** The one status of every editor (specs/visual-editing-spec.md, VE-D70). */
import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { translocoTestingModule } from '../../../../test/transloco-test-providers';
import en from '../../../../assets/i18n/en.json';
import { EDIT_STATE_KEYS, editState } from './edit-state';
import { EditStateComponent, PageStatusComponent } from './page-status.component';
import { SharePreviewComponent } from './share-preview.component';

const at = (part: Partial<Parameters<typeof editState>[0]>) =>
    editState({ saving: false, failed: false, publishing: false, changed: false, live: true, ...part });

describe('editState', () => {
    it('says what visitors see, on opening too', () => {
        expect(at({})).toBe('published');
        expect(at({ changed: true })).toBe('changes');
        expect(at({ live: false })).toBe('never');
        expect(at({ live: false, changed: true })).toBe('never');
    });

    it('puts a save first, then a failed save, then a publish', () => {
        expect(at({ saving: true, failed: true, publishing: true, changed: true })).toBe('saving');
        expect(at({ failed: true, publishing: true, changed: true })).toBe('not_saved');
        expect(at({ publishing: true, changed: true })).toBe('publishing');
        expect(at({ publishing: true, live: false })).toBe('publishing');
    });

    it('has words for every state', () => {
        for (const key of Object.values(EDIT_STATE_KEYS)) {
            const value = key.split('.').reduce<any>((node, part) => node?.[part], en);
            expect(value, key).toBeTruthy();
        }
    });
});

describe('the status and the preview', () => {
    const make = <T>(type: new (...args: any[]) => T, inputs: Record<string, unknown>): HTMLElement => {
        TestBed.configureTestingModule({ imports: [type, translocoTestingModule()] });
        const fixture = TestBed.createComponent(type);
        for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    };

    it('shows the state and that nothing was published yet', () => {
        const el = make(PageStatusComponent, { state: 'never', lastPublished: null });
        expect(el.querySelector('[data-testid="edit-state"]')?.textContent).toContain('Not published yet');
        expect(el.querySelector('[data-testid="last-published"]')?.textContent?.trim()).toBe('Never');
    });

    it('is amber for saved changes, in both looks', () => {
        const el = make(EditStateComponent, { state: 'changes', dark: true });
        const badge = el.querySelector('[data-testid="edit-state"]')!;
        expect(badge.classList.contains('state-changes')).toBe(true);
        expect(badge.classList.contains('dark')).toBe(true);
        expect(badge.textContent).toContain('Saved, not published');
    });

    it('draws what goes out, and falls back to the host for a page with no title', () => {
        const el = make(SharePreviewComponent, { title: '', description: 'Fresh bread', image: '', url: 'https://example.com/p/about' });
        expect(el.querySelector('.search-title')?.textContent).toContain('example.com');
        expect(el.querySelector('.share-host')?.textContent).toContain('example.com');
        expect(el.querySelector('.share-none')).not.toBeNull();
        expect(el.querySelector('.search-text')?.textContent).toContain('Fresh bread');
    });
});
