import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { PWA, PwaService } from '../../../app/core/pwa/pwa.service';

/**
 * "Install the app", the right way for each browser (docs/pwa.md):
 *
 *   Android, desktop Chrome and Edge   an Install button (the browser's own dialog)
 *   iPhone and iPad, Safari            two steps: Share, then Add to Home Screen
 *   iPhone and iPad, other browsers    open this page in Safari, with a Copy link button
 *
 * Shows nothing when the app is installed, the browser cannot install it, the
 * PWA is off, or the person chose "Not now" recently. Place it anywhere:
 * `<arc-install-prompt />`.
 */
@Component({
    selector: 'arc-install-prompt',
    standalone: true,
    imports: [TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (pwa.showInstall()) {
            <section class="install-card" [style.--install-accent]="accent" [attr.aria-label]="'common.pwa.install_title' | transloco">
                <div class="install-icon"><i class="fa-solid fa-mobile-screen-button"></i></div>
                <div class="install-body">
                    <h3>{{ 'common.pwa.install_title' | transloco }}</h3>
                    @switch (pwa.installMode()) {
                        @case ('ios-safari') {
                            <ol class="install-steps">
                                <li><i class="fa-solid fa-arrow-up-from-bracket"></i>{{ 'common.pwa.ios_step_share' | transloco }}</li>
                                <li><i class="fa-regular fa-square-plus"></i>{{ 'common.pwa.ios_step_add' | transloco }}</li>
                            </ol>
                        }
                        @case ('ios-other') {
                            <p>{{ (copied() ? 'common.pwa.link_copied' : 'common.pwa.ios_other') | transloco }}</p>
                        }
                        @default {
                            <p>{{ 'common.pwa.install_note' | transloco }}</p>
                        }
                    }
                    <div class="install-actions">
                        @if (pwa.installMode() === 'prompt') {
                            <button type="button" class="btn btn-primary btn-sm" (click)="pwa.install()">
                                {{ 'common.pwa.install' | transloco }}
                            </button>
                        }
                        @if (pwa.installMode() === 'ios-other') {
                            <button type="button" class="btn btn-primary btn-sm" (click)="copyLink()">
                                {{ 'common.pwa.copy_link' | transloco }}
                            </button>
                        }
                        <button type="button" class="btn btn-link btn-sm" (click)="pwa.dismiss()">
                            {{ 'common.pwa.not_now' | transloco }}
                        </button>
                    </div>
                </div>
            </section>
        }
    `,
    styles: [`
        .install-card {
            display: flex;
            gap: 1rem;
            align-items: flex-start;
            padding: 1rem 1.25rem;
            border: 1px solid var(--bs-border-color, #dee2e6);
            border-radius: 12px;
            background: var(--bs-body-bg, #fff);
        }
        .install-icon {
            flex: 0 0 auto;
            width: 2.5rem;
            height: 2.5rem;
            border-radius: 10px;
            display: grid;
            place-items: center;
            background: color-mix(in srgb, var(--install-accent) 12%, transparent);
            color: var(--install-accent);
            font-size: 1.25rem;
        }
        .install-body { flex: 1 1 auto; min-width: 0; }
        h3 { font-size: 1rem; font-weight: 600; margin: 0 0 0.25rem; }
        p { margin: 0; color: var(--bs-secondary-color, #6c757d); font-size: 0.9rem; }
        .install-steps { margin: 0; padding-left: 1.25rem; font-size: 0.9rem; }
        .install-steps li { margin: 0.25rem 0; }
        .install-steps i { margin-right: 0.5rem; color: var(--install-accent); }
        .install-actions { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.75rem; }
    `],
})
export class InstallPromptComponent {
    readonly pwa = inject(PwaService);
    readonly copied = signal(false);
    /** The app's theme colour (src/custom/pwa.ts). */
    readonly accent = PWA.themeColor;

    constructor() {
        effect(() => {
            if (this.pwa.showInstall()) this.pwa.shown();
        });
    }

    async copyLink(): Promise<void> {
        try {
            await navigator.clipboard.writeText(location.href);
            this.copied.set(true);
        } catch {
            // no clipboard access: the text already says to open the page in Safari
        }
    }
}
