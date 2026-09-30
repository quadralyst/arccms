import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { PwaService } from '../../../app/core/pwa/pwa.service';

/**
 * "A new version is ready" after a deploy (docs/features/pwa.html). It never reloads by
 * itself, so nobody is cut off mid-way: the person chooses when to update.
 * Placed once, in the app root.
 */
@Component({
    selector: 'arc-pwa-update-bar',
    standalone: true,
    imports: [TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (pwa.updateReady()) {
            <div class="update-bar" role="status">
                <span>{{ 'common.pwa.update_ready' | transloco }}</span>
                <button type="button" class="btn btn-light btn-sm" (click)="pwa.update()">{{ 'common.pwa.update' | transloco }}</button>
                <button type="button" class="btn-close btn-close-white" [attr.aria-label]="'common.actions.close' | transloco"
                    (click)="pwa.updateReady.set(false)"></button>
            </div>
        }
    `,
    styles: [`
        .update-bar {
            position: fixed;
            left: 50%;
            bottom: max(1rem, env(safe-area-inset-bottom));
            transform: translateX(-50%);
            z-index: 1080;
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
export class PwaUpdateBarComponent {
    readonly pwa = inject(PwaService);
}
