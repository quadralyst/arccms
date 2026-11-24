import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { StaleCodeService } from './stale-code.service';

/**
 * Shown only when loading the newer version did not open the screen either
 * (specs/app-route-code-spec.md, R-D6): asks the person to reload. Placed once, in the app root.
 */
@Component({
    selector: 'arc-stale-code-bar',
    standalone: true,
    imports: [TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (stale.needsReload()) {
            <div class="stale-bar" role="alert">
                <span>{{ 'common.version.not_loaded' | transloco }}</span>
                <button type="button" class="btn btn-light btn-sm" (click)="stale.reload()">{{ 'common.version.reload' | transloco }}</button>
            </div>
        }
    `,
    styles: [`
        /* As wide as its words, up to the room between the screen's edges, as the update bar (F52). */
        .stale-bar {
            position: fixed;
            left: max(1rem, env(safe-area-inset-left));
            right: max(1rem, env(safe-area-inset-right));
            bottom: max(1rem, env(safe-area-inset-bottom));
            width: fit-content;
            margin-inline: auto;
            z-index: 1081;
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 0.5rem 0.75rem;
            padding-block: 0.625rem;
            padding-inline: 1rem 0.75rem;
            border-radius: 12px;
            background: #1f2937;
            color: #fff;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
            font-size: 0.9rem;
        }
        .stale-bar > span {
            flex: 1 1 0;
            min-width: min(8em, 100%);
        }
    `],
})
export class StaleCodeBarComponent {
    readonly stale = inject(StaleCodeService);
}
