import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ArcTimePipe } from '../../../core/time/arc-time.pipe';
import { momentMillis, type EditingHold } from '../../../core/editing/hold';

/**
 * Someone else holds what is open (specs/visual-editing-spec.md, VE-D79): who, when
 * they last changed something, and Review changes. The same bar on both editors of
 * an entry and of a page. When words typed here were not saved (VE-D82), it says
 * they are still on screen to copy.
 */
@Component({
    selector: 'arc-hold-bar',
    standalone: true,
    imports: [ArcTimePipe, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="hold-bar" role="status" data-testid="hold-bar">
        <i class="fa-solid fa-user-lock" aria-hidden="true"></i>
        <span class="hold-text">
            <b>{{ (lost() ? 'admin.hold.took_over' : 'admin.hold.held') | transloco: { name: who() } }}</b>&ngsp;
            @if (at(); as at) { <span class="hold-when">{{ 'admin.hold.last_change' | transloco }} {{ at | arcTime: 'ago' }}.</span>&ngsp; }
            {{ (lost() ? 'admin.hold.lost_words' : 'admin.hold.view_only') | transloco }}
        </span>
        @if (lost()) {
        <button type="button" class="btn btn-outline-secondary btn-sm" (click)="showTheirs.emit()" data-testid="hold-reload">{{ 'admin.hold.show_theirs' | transloco }}</button>
        }
        <button type="button" class="btn btn-primary btn-sm" (click)="review.emit()" data-testid="hold-review">{{ 'admin.hold.review' | transloco }}</button>
    </div>`,
    styles: [`
        :host { display: block; flex: 0 0 auto; }
        .hold-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 14px; background: #fff3cd; color: #4d3800; border-bottom: 1px solid #ffe08a; font-size: .9rem; }
        .hold-text { flex: 1 1 260px; }
    `],
})
export class HoldBarComponent {
    readonly hold = input.required<EditingHold>();
    /** Words typed here were not saved when it was taken over, or held first. */
    readonly lost = input(false);
    readonly review = output<void>();
    readonly showTheirs = output<void>();
    readonly who = computed(() => this.hold().name || '?');
    readonly at = computed(() => momentMillis(this.hold().at));
}
