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
        .stale-bar {
            position: fixed;
            left: 50%;
            bottom: max(1rem, env(safe-area-inset-bottom));
            transform: translateX(-50%);
            z-index: 1081;
            display: flex;
            align-items: center;
            gap: 0.75rem;
            max-width: calc(100vw - 2rem);
            padding: 0.625rem 0.75rem 0.625rem 1rem;
            border-radius: 12px;
            background: #1f2937;
            color: #fff;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
            font-size: 0.9rem;
        }
    `],
})
export class StaleCodeBarComponent {
    readonly stale = inject(StaleCodeService);
}
