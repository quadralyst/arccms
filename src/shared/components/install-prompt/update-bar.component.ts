import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { PwaService } from '../../../app/core/pwa/pwa.service';
import { PwaUpdateRouteService } from '../../../app/core/pwa/pwa-update-route';

/**
 * "A new version is ready" after a deploy (docs/features/pwa.html). It never reloads by
 * itself, so nobody is cut off mid-way: the person chooses when to update.
 * Placed once, in the app root. It stays out of the way on pages where the app shows the
 * update itself (`data: { pwaUpdate: 'app' }`, docs/app/pwa.html).
 */
@Component({
    selector: 'arc-pwa-update-bar',
    standalone: true,
    imports: [TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (pwa.updateReady() && !pwa.updateBarClosed() && !route.appOwns()) {
            <div class="update-bar" role="status">
                <span>{{ 'common.pwa.update_ready' | transloco }}</span>
                <div class="update-bar-actions">
                    <button type="button" class="btn btn-light btn-sm" (click)="pwa.applyUpdate()">{{ 'common.pwa.update' | transloco }}</button>
                    <button type="button" class="btn-close btn-close-white" [attr.aria-label]="'common.actions.close' | transloco"
                        (click)="pwa.dismissUpdate()"></button>
                </div>
            </div>
        }
    `,
    styles: [`
        /* As wide as its words, up to the room between the screen's edges, and centred in it.
           Placed from both sides: from left: 50% a box only has half the screen (F52). */
        .update-bar {
            position: fixed;
            left: max(1rem, env(safe-area-inset-left));
            right: max(1rem, env(safe-area-inset-right));
            bottom: max(1rem, env(safe-area-inset-bottom));
            width: fit-content;
            margin-inline: auto;
            z-index: 1080;
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
        /* The words take what the buttons leave, and break there; with less than 8em left
           (a narrow screen, large text), the buttons go under them, together. */
        .update-bar > span {
            flex: 1 1 0;
            min-width: min(8em, 100%);
        }
        .update-bar-actions {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: flex-end;
            gap: 0.5rem 0.75rem;
            margin-inline-start: auto;
        }
    `],
})
export class PwaUpdateBarComponent {
    readonly pwa = inject(PwaService);
    readonly route = inject(PwaUpdateRouteService);
}
