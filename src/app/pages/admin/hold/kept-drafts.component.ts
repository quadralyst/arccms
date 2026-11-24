import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { injectT } from '../../../core/i18n/inject-t';
import { ArcTimePipe } from '../../../core/time/arc-time.pipe';
import { HoldService, type KeptDraft } from '../../../core/editing/hold.service';
import { momentMillis } from '../../../core/editing/hold';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';

/**
 * The drafts kept before a take over or a Discard (specs/visual-editing-spec.md,
 * VE-D84), at the top of History, each with Restore. Nothing shows when there are none.
 */
@Component({
    selector: 'arc-kept-drafts',
    standalone: true,
    imports: [ArcTimePipe, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    @if (kept().length) {
    <div class="kept" data-testid="kept-drafts">
        <b class="kept-title">{{ 'admin.hold.kept_title' | transloco }}</b>
        @for (draft of kept(); track draft.id) {
        <div class="kept-row">
            <div>
                <div>{{ 'admin.hold.kept_of' | transloco: { name: draft.name || '?' } }}, {{ millis(draft) | arcTime: 'dateTime' }}</div>
                <small class="text-muted">{{ (draft.why === 'takeover' ? 'admin.hold.kept_takeover' : 'admin.hold.kept_discard') | transloco }}</small>
            </div>
            <button type="button" class="btn btn-outline-secondary btn-sm" (click)="ask(draft)" [disabled]="locked()">{{ 'admin.hold.kept_restore' | transloco }}</button>
        </div>
        }
    </div>
    }`,
    styles: [`
        .kept { padding: 12px 16px; border-bottom: 1px solid var(--bs-border-color, #dee2e6); }
        .kept-title { font-size: .85rem; }
        .kept-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 0; font-size: .9rem; }
    `],
})
export class KeptDraftsComponent {
    private holds = inject(HoldService);
    private confirm = inject(ConfirmService);
    private t = injectT();
    readonly path = input.required<string>();
    /** Someone else holds it: nothing is restored. */
    readonly locked = input(false);
    /** Changes when the list should be read again. */
    readonly again = input<unknown>(0);
    readonly restore = output<KeptDraft>();
    readonly kept = signal<KeptDraft[]>([]);

    constructor() {
        effect(() => {
            const path = this.path();
            this.again();
            this.locked();
            if (path) void this.read(path);
        });
    }

    private async read(path: string): Promise<void> {
        try {
            const kept = await this.holds.kept(path);
            if (this.path() === path) this.kept.set(kept);
        } catch (error) {
            console.error('[Hold] Could not read the kept drafts:', error);
        }
    }

    millis(draft: KeptDraft): number | null {
        return momentMillis(draft.keptAt);
    }

    async ask(draft: KeptDraft): Promise<void> {
        const ok = await this.confirm.ask({
            titleKey: 'admin.contents.editor.restore_title',
            dialogMessage: this.t('admin.hold.kept_restore_confirm'),
            btnText: this.t('admin.hold.kept_restore'),
        });
        if (!ok) return;
        this.restore.emit(draft);
    }
}
