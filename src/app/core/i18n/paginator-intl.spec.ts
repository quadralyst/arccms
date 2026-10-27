import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { firstValueFrom } from 'rxjs';
import en from '../../../assets/i18n/en.json';
import { useTranslatedPaginator } from './paginator-intl';

describe('useTranslatedPaginator', () => {
    function setup() {
        TestBed.configureTestingModule({
            imports: [
                TranslocoTestingModule.forRoot({
                    langs: { en },
                    translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
                    preloadLangs: false,
                }),
            ],
        });
    }

    it('picks the labels up when the translation file loads after it was called', async () => {
        setup();
        const intl = TestBed.runInInjectionContext(() => useTranslatedPaginator());
        let changes = 0;
        intl.changes.subscribe(() => changes++);

        await firstValueFrom(TestBed.inject(TranslocoService).load('en'));

        expect(intl.itemsPerPageLabel).toBe(en.common.paginator.items_per_page);
        expect(intl.nextPageLabel).toBe(en.common.paginator.next_page);
        expect(changes).toBeGreaterThan(0);
        expect(intl.getRangeLabel(0, 10, 47)).not.toContain('common.paginator');
    });

    it('translates Material\'s own app-wide object, which every paginator and dialog reads, once', async () => {
        setup();
        await firstValueFrom(TestBed.inject(TranslocoService).load('en'));
        const intl = TestBed.runInInjectionContext(() => useTranslatedPaginator());
        expect(intl).toBe(TestBed.inject(MatPaginatorIntl));
        const range = intl.getRangeLabel;
        expect(TestBed.runInInjectionContext(() => useTranslatedPaginator())).toBe(intl);
        expect(intl.getRangeLabel).toBe(range);
        expect(intl.getRangeLabel(0, 10, 0)).not.toContain('common.paginator');
    });
});
