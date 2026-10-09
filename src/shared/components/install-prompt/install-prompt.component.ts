import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { PWA, PwaService } from '../../../app/core/pwa/pwa.service';

/**
 * "Install the app", the right way for each browser (docs/features/pwa.html):
 *
 *   Android, desktop Chrome and Edge         an Install button (the browser's own dialog)
 *   iPhone and iPad, Safari                  two steps: Share, then Add to Home Screen
 *   iPhone and iPad, Chrome, Edge, Firefox   the same two steps, from that browser's Share button
 *   a web view inside another app            open this page in Safari, with a Copy link button
 *
 * Shows nothing when the app is installed, the browser cannot install it, the
 * PWA is off, or the person chose "Not now" recently. Place it anywhere:
 * `<arc-install-prompt />`. It carries its own styles and icons (inline SVG), so
 * it looks the same inside a Shadow DOM host, where Bootstrap and Font Awesome
 * do not reach.
 */
@Component({
    selector: 'arc-install-prompt',
    standalone: true,
    imports: [NgTemplateOutlet, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (pwa.showInstall()) {
            <section class="install-card" [style.--install-accent]="accent" [attr.aria-label]="'common.pwa.install_title' | transloco">
                <div class="install-icon">
                    <!-- A phone -->
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>
                </div>
                <div class="install-body">
                    <h3>{{ 'common.pwa.install_title' | transloco }}</h3>
                    @switch (pwa.installMode()) {
                        @case ('ios-safari') {
                            <ol class="install-steps">
                                <li><ng-container *ngTemplateOutlet="share" />{{ 'common.pwa.ios_step_share' | transloco }}</li>
                                <li><ng-container *ngTemplateOutlet="add" />{{ 'common.pwa.ios_step_add' | transloco }}</li>
                            </ol>
                        }
                        @case ('ios-browser') {
                            <ol class="install-steps">
                                <li><ng-container *ngTemplateOutlet="share" />{{ 'common.pwa.ios_step_share_browser' | transloco }}</li>
                                <li><ng-container *ngTemplateOutlet="add" />{{ 'common.pwa.ios_step_add' | transloco }}</li>
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
                            <button type="button" class="install-button install-button-primary" (click)="pwa.install()">
                                {{ 'common.pwa.install' | transloco }}
                            </button>
                        }
                        @if (pwa.installMode() === 'ios-other') {
                            <button type="button" class="install-button install-button-primary" (click)="copyLink()">
                                {{ 'common.pwa.copy_link' | transloco }}
                            </button>
                        }
                        <button type="button" class="install-button install-button-quiet" (click)="pwa.dismiss()">
                            {{ 'common.pwa.not_now' | transloco }}
                        </button>
                    </div>
                </div>
            </section>
        }

        <!-- The Share icon: a box with an arrow out of its top -->
        <ng-template #share>
            <svg class="step-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M8.5 10.5H6.5a1.5 1.5 0 0 0-1.5 1.5v7.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5h-2"/></svg>
        </ng-template>
        <!-- Add to Home Screen: a square with a plus -->
        <ng-template #add>
            <svg class="step-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.5v7M8.5 12h7"/></svg>
        </ng-template>
    `,
    styles: [`
        :host {
            display: block;
            font-family: inherit;
            color: #212529;
        }
        .install-card {
            display: flex;
            gap: 1rem;
            align-items: flex-start;
            padding: 1rem 1.25rem;
            border: 1px solid var(--bs-border-color, #dee2e6);
            border-radius: 12px;
            background: var(--bs-body-bg, #fff);
            box-sizing: border-box;
        }
        svg {
            fill: none;
            stroke: currentColor;
            stroke-width: 1.8;
            stroke-linecap: round;
            stroke-linejoin: round;
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
        }
        .install-icon svg { width: 1.4rem; height: 1.4rem; }
        .install-body { flex: 1 1 auto; min-width: 0; }
        h3 { font-size: 1rem; font-weight: 600; line-height: 1.3; margin: 0 0 0.25rem; }
        p { margin: 0; color: var(--bs-secondary-color, #6c757d); font-size: 0.9rem; line-height: 1.4; }
        .install-steps { margin: 0; padding-left: 1.25rem; font-size: 0.9rem; line-height: 1.4; }
        .install-steps li { margin: 0.25rem 0; }
        .step-icon {
            width: 1.1em;
            height: 1.1em;
            margin-right: 0.4rem;
            vertical-align: -0.2em;
            color: var(--install-accent);
        }
        .install-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-top: 0.75rem; }
        .install-button {
            appearance: none;
            font: inherit;
            font-size: 0.875rem;
            font-weight: 500;
            line-height: 1.5;
            padding: 0.25rem 0.75rem;
            border-radius: 6px;
            border: 1px solid transparent;
            cursor: pointer;
        }
        .install-button-primary {
            background: var(--install-accent);
            border-color: var(--install-accent);
            color: #fff;
        }
        .install-button-primary:hover { filter: brightness(0.92); }
        .install-button-quiet {
            background: transparent;
            color: var(--install-accent);
        }
        .install-button-quiet:hover { text-decoration: underline; }
        .install-button:focus-visible {
            outline: 2px solid var(--install-accent);
            outline-offset: 2px;
        }
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
