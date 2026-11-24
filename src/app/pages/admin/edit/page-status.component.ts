import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ArcTimePipe } from '../../../core/time/arc-time.pipe';
import { EDIT_STATE_KEYS, type EditState } from './edit-state';

/**
 * The status of VE-D70 as one badge, for an editor's bar. On the Visual Editor's
 * dark strip `dark` gives it the strip's colours.
 */
@Component({
    selector: 'arc-edit-state',
    standalone: true,
    imports: [TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<span class="badge-state" [class]="'badge-state state-' + state()" [class.dark]="dark()" role="status" data-testid="edit-state">{{ key() | transloco }}</span>`,
    styles: [`
        :host { display: inline-flex; min-width: 0; }
        .badge-state { font-size: .8rem; padding: 2px 10px; border-radius: 999px; white-space: nowrap; background: #eef0f2; color: #495057; }
        .state-published { background: #e3f4e8; color: #1e6b34; }
        .state-changes, .state-never { background: #fff3cd; color: #6b4e00; }
        .state-not_saved { background: #f8d7da; color: #842029; }
        .state-publishing { background: #e7f0ff; color: #084298; }
        .dark { font-size: 13px; padding: 1px 8px; background: #4b5563; color: #fff; }
        .dark.state-published { background: #15803d; }
        .dark.state-changes, .dark.state-never { background: #fbbf24; color: #1f2937; }
        .dark.state-not_saved { background: #b91c1c; }
        .dark.state-publishing { background: #1d4ed8; }
    `],
})
export class EditStateComponent {
    readonly state = input.required<EditState>();
    readonly dark = input(false);
    readonly key = computed(() => EDIT_STATE_KEYS[this.state()]);
}

/** The top of Page settings' Basic tab (VE-D67): Status and Last published, the same on every kind of page. */
@Component({
    selector: 'arc-page-status',
    standalone: true,
    imports: [ArcTimePipe, TranslocoPipe, EditStateComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="status-row">
            <span class="status-label">{{ 'admin.edit_page.status' | transloco }}</span>
            <arc-edit-state [state]="state()" />
        </div>
        <div class="status-row">
            <span class="status-label">{{ 'admin.edit_page.last_published' | transloco }}</span>
            <span data-testid="last-published">@if (lastPublished()) { {{ lastPublished() | arcTime: 'dateTime' }} } @else { {{ 'admin.edit_page.never_published' | transloco }} }</span>
        </div>
    `,
    styles: [`
        :host { display: block; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--bs-border-color, #dee2e6); }
        .status-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; font-size: .9rem; }
        .status-label { font-size: .85rem; font-weight: 600; }
    `],
})
export class PageStatusComponent {
    readonly state = input.required<EditState>();
    readonly lastPublished = input<Date | number | null>(null);
}
