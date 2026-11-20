/**
 * The page's panel on the Visual Editor (page-text-panel.component.ts,
 * specs/visual-editing-spec.md VE-D51, VE-D53): its Publish also takes the changed
 * cards, so it is on when only cards changed, and it runs the screen's checks
 * and the screen's one Publish.
 */
import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { translocoTestingModule } from '../../../../test/transloco-test-providers';
import { PageTextService } from '../../../core/site/page-text.service';
import { PageTextPanelComponent } from './page-text-panel.component';

describe('PageTextPanelComponent with cards (VE-D53)', () => {
    let push: (value: unknown) => void = () => undefined;
    const stop = vi.fn();
    async function make(extra: number) {
        const session = { pageId: 'home', draft: signal<any>(null), publish: vi.fn() };
        await TestBed.configureTestingModule({
            imports: [PageTextPanelComponent, translocoTestingModule()],
            providers: [
                { provide: MatDialog, useValue: {} },
                { provide: PageTextService, useValue: {
                    published: vi.fn().mockResolvedValue(null), history: vi.fn().mockResolvedValue([]),
                    followPublished: (_id: string, next: (value: unknown) => void) => { push = next; next(null); return stop; },
                } },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(PageTextPanelComponent);
        const publishWith = vi.fn().mockResolvedValue(undefined);
        const beforePublish = vi.fn().mockResolvedValue(true);
        fixture.componentRef.setInput('session', session);
        fixture.componentRef.setInput('lang', 'en');
        fixture.componentRef.setInput('defaultLang', 'en');
        fixture.componentRef.setInput('extraChanges', extra);
        fixture.componentRef.setInput('publishWith', publishWith);
        fixture.componentRef.setInput('beforePublish', beforePublish);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return { fixture, session, publishWith, beforePublish };
    }

    it('is off with nothing to publish', async () => {
        const { fixture } = await make(0);
        expect((fixture.nativeElement.querySelector('[data-testid="publish"]') as HTMLButtonElement).disabled).toBe(true);
    });

    it('is on when only cards changed, and runs the checks, then the one Publish', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        try {
            const { fixture, session, publishWith, beforePublish } = await make(2);
            const button = fixture.nativeElement.querySelector('[data-testid="publish"]') as HTMLButtonElement;
            expect(button.disabled).toBe(false);
            await fixture.componentInstance.publish();
            expect(beforePublish).toHaveBeenCalled();
            expect(publishWith).toHaveBeenCalled();
            expect(session.publish).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('follows the published copy: another editor\'s publish, and a page that did not go live', async () => {
        const { fixture, session } = await make(0);
        const panel = fixture.componentInstance;
        session.draft.set({ updatedAt: { toMillis: () => 5 } });
        expect(panel.status()).toBe('changes');
        push({ draftUpdatedAt: { toMillis: () => 5 }, publishedAt: { toMillis: () => 6 } });
        expect(panel.status()).toBe('published');

        session.draft.set({ updatedAt: { toMillis: () => 7 } });
        panel.awaitPublish();
        expect(panel.publishing()).toBe(true);
        push({ draftUpdatedAt: null, publishedAt: { toMillis: () => 8 } });
        expect(panel.publishing()).toBe(false);
        expect(panel.publishError()).toContain('did not go live');
        fixture.destroy();
        expect(stop).toHaveBeenCalled();
    });
});
