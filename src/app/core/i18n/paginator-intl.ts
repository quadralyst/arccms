/**
 * Translated labels for `<mat-paginator>`.
 *
 * Angular Material ships its own English strings and does not know Transloco
 * exists, so without this the paginator reads "Items per page: 1 – 10 of 47"
 * under a fully translated table — on nine pages of this admin.
 *
 * `changes` is how Material learns a label moved; emitting on every language
 * change is what makes the switch take effect without a reload. It also emits
 * when a translation file finishes loading: `translate()` returns the bare key
 * until then, and on a first visit (a fresh install arriving from the
 * onboarding wizard) the paginator can render before the file is in.
 *
 * Spec: specs/multilingual-spec.md — Phase M6.
 */

import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { TranslocoService } from '@jsverse/transloco';
import { filter, merge } from 'rxjs';

@Injectable()
export class TranslatedPaginatorIntl extends MatPaginatorIntl {
    private transloco = inject(TranslocoService);
    private destroyRef = inject(DestroyRef);

    constructor() {
        super();
        merge(
            this.transloco.langChanges$,
            this.transloco.events$.pipe(filter((event) => event.type === 'translationLoadSuccess')),
        )
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.applyLabels());
    }

    private applyLabels(): void {
        this.itemsPerPageLabel = this.transloco.translate('common.paginator.items_per_page');
        this.nextPageLabel = this.transloco.translate('common.paginator.next_page');
        this.previousPageLabel = this.transloco.translate('common.paginator.previous_page');
        this.firstPageLabel = this.transloco.translate('common.paginator.first_page');
        this.lastPageLabel = this.transloco.translate('common.paginator.last_page');
        this.changes.next();
    }

    /**
     * Material's default builds this string by concatenation, which cannot be
     * reordered by a translator. A single key with three parameters can.
     */
    override getRangeLabel = (page: number, pageSize: number, length: number): string => {
        const total = Math.max(length, 0);
        if (total === 0 || pageSize === 0) {
            return this.transloco.translate('common.paginator.range_empty', { total });
        }

        const start = page * pageSize;
        // A page size larger than the remaining items must not report an end
        // past the total — Material's own implementation guards this too.
        const end = start < total
            ? Math.min(start + pageSize, total)
            : start + pageSize;

        return this.transloco.translate('common.paginator.range', {
            start: start + 1,
            end,
            total,
        });
    };
}
