/**
 * The setup wizard rendered: each step in Hindi shows Hindi, every field has a
 * label read out with it, and the show-password buttons have names.
 */
import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import OnboardingComponent from './onboarding.page';
import { AuthState } from '../(auth)/auth.store';
import { OnboardingSetupService } from './onboarding-setup.service';
import { EmailSettingService } from '../admin/(settings)/email-setting/email-setting.service';
import { ToastService } from '../../../shared/services/toast.service';
import { LegalNoticeComponent } from '../../../shared/components/legal-notice/legal-notice.component';
import { translocoTestingModule } from '../../../test/transloco-test-providers';

function render(lang: string, step: 1 | 2 | 3 | 4 | 5) {
    TestBed.configureTestingModule({
        imports: [OnboardingComponent, translocoTestingModule({ lang })],
        providers: [
            provideRouter([]),
            { provide: Auth, useValue: { currentUser: null } },
            {
                provide: AuthState,
                useValue: {
                    isLoading: signal(false), isSuccess: signal(false), error: signal(''),
                    errorCode: signal(''), currentUser: signal(null), clearList: vi.fn(), signup: vi.fn(),
                },
            },
            { provide: OnboardingSetupService, useValue: { getOnboardingState: () => of('first-run') } },
            { provide: EmailSettingService, useValue: {} },
            { provide: ToastService, useValue: { openCustomSnackbar: vi.fn() } },
        ],
    });
    // The legal notice reads the site's pages from Firestore; it is not this page's text.
    TestBed.overrideComponent(OnboardingComponent, {
        remove: { imports: [LegalNoticeComponent] },
        add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.componentInstance.currentStep.set(step);
    fixture.detectChanges();
    return fixture;
}

/** Visible text with the parts that are the same in every language taken out. */
function words(root: HTMLElement): string {
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('code, a[href^="http"], option, .copyright').forEach((node) => node.remove());
    return (clone.textContent ?? '')
        .replace(/Arc CMS|Gmail|SMTP|SSL\/TLS|SSL|TLS|Firebase|Email\/Password|Resend|onboarding@resend\.dev|re_|Create API key|Create|ipapi\.co|Articles|Outlook|Yahoo/g, ' ')
        .replace(/\s+/g, ' ');
}

describe('the setup wizard, rendered', () => {
    beforeEach(() => TestBed.resetTestingModule());

    for (const step of [1, 2, 3, 4, 5] as const) {
        it(`shows step ${step} in Hindi with no English sentence left`, () => {
            const text = words(render('hi', step).nativeElement);
            expect(text).toMatch(/[ऀ-ॿ]/);
            expect(text.match(/[A-Za-z]{3,}(?: [A-Za-z]{3,})+/g) ?? []).toEqual([]);
        });
    }

    it('ties every field to a label on the account and email steps', () => {
        for (const step of [1, 2, 4] as const) {
            TestBed.resetTestingModule();
            const root: HTMLElement = render('en', step).nativeElement;
            const fields = [...root.querySelectorAll('input, select')];
            expect(fields.length).toBeGreaterThan(0);
            for (const field of fields) {
                const label = root.querySelector(`label[for="${field.id}"]`);
                expect(label?.textContent?.trim(), `step ${step} #${field.id}`).toBeTruthy();
            }
        }
    });

    it('names the show-password buttons once, and says by aria-pressed when the password shows', () => {
        const fixture = render('en', 2);
        const root: HTMLElement = fixture.nativeElement;
        const toggles = [...root.querySelectorAll<HTMLButtonElement>('button.eye_btn')];
        expect(toggles.length).toBe(2);
        expect(toggles.map((b) => b.getAttribute('aria-label'))).toEqual(['Show password', 'Show password']);
        toggles[0].click();
        fixture.detectChanges();
        // A toggle keeps its name; its state is aria-pressed (never both changing).
        expect(toggles[0].getAttribute('aria-label')).toBe('Show password');
        expect(toggles[0].getAttribute('aria-pressed')).toBe('true');
        expect(root.querySelector<HTMLInputElement>('#password')!.type).toBe('text');
    });

    it('ties the site address and sender email errors to their fields', () => {
        const html = readFileSync(join(__dirname, 'onboarding.page.html'), 'utf8');
        for (const id of ['siteUrl', 'senderEmail']) {
            expect(html, id).toContain(`id="${id}Error"`);
            expect(html, id).toContain(`'${id}Error ${id}Hint'`);
        }
    });
});
