import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The spinner a public page shows while its body is still on the way.
 *
 * It stretches to fill whatever flex column it sits in, so the footer below
 * it stays at the bottom of the viewport instead of hugging the header until
 * the content arrives. The app shell uses it between routes, and the content
 * pages use it before their first client-side data lands.
 */
@Component({
    selector: 'arc-page-spinner',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="arc-page-spinner" role="status" aria-live="polite">
            <div class="spinner-border text-primary">
                <span class="visually-hidden">Loading...</span>
            </div>
        </div>
    `,
    styles: [`
        :host {
            display: flex;
            flex: 1 1 auto;
            flex-direction: column;
            min-height: 60vh;
        }

        .arc-page-spinner {
            flex: 1 1 auto;
            display: flex;
            align-items: center;
            justify-content: center;
        }
    `],
})
export class PageSpinnerComponent {}
