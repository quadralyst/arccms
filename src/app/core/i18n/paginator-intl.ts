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

import { inject } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { TranslocoService } from '@jsverse/transloco';
import { filter, merge } from 'rxjs';

/** The labels objects already translated: the app has one, made by Material. */
const translated = new WeakSet<MatPaginatorIntl>();

/**
 * Puts translated labels on the app's MatPaginatorIntl, for as long as the app runs.
 * Called by the admin layout (admin.page.ts), the only place with paginators, rather
 * than provided in app.config.ts: that would put Angular Material in the first script
 * every page loads (F34). Material's own object is changed in place, so a paginator
 * in a dialog gets the same labels. Call it in an injection context; a second call
 * does nothing.
 */
export function useTranslatedPaginator(): MatPaginatorIntl {
    const intl = inject(MatPaginatorIntl);
    if (translated.has(intl)) return intl;
    translated.add(intl);
    const transloco = inject(TranslocoService);
    const apply = () => {
        intl.itemsPerPageLabel = transloco.translate('common.paginator.items_per_page');
        intl.nextPageLabel = transloco.translate('common.paginator.next_page');
        intl.previousPageLabel = transloco.translate('common.paginator.previous_page');
        intl.firstPageLabel = transloco.translate('common.paginator.first_page');
        intl.lastPageLabel = transloco.translate('common.paginator.last_page');
        intl.changes.next();
    };
    /**
     * Material's default builds this string by concatenation, which cannot be
     * reordered by a translator. A single key with three parameters can.
     */
    intl.getRangeLabel = (page: number, pageSize: number, length: number): string => {
        const total = Math.max(length, 0);
        if (total === 0 || pageSize === 0) {
            return transloco.translate('common.paginator.range_empty', { total });
        }

        const start = page * pageSize;
        // A page size larger than the remaining items must not report an end
        // past the total — Material's own implementation guards this too.
        const end = start < total
            ? Math.min(start + pageSize, total)
            : start + pageSize;

        return transloco.translate('common.paginator.range', {
            start: start + 1,
            end,
            total,
        });
    };
    // The app-wide object lives as long as the app, so this never needs undoing.
    merge(
        transloco.langChanges$,
        transloco.events$.pipe(filter((event) => event.type === 'translationLoadSuccess')),
    ).subscribe(apply);
    apply();
    return intl;
}
