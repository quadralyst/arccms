import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import en from '../../../assets/i18n/en.json';
import { TranslatedPaginatorIntl } from './paginator-intl';

describe('TranslatedPaginatorIntl', () => {
    it('picks the labels up when the translation file loads after it was created', async () => {
        TestBed.configureTestingModule({
            imports: [
                TranslocoTestingModule.forRoot({
                    langs: { en },
                    translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
                    preloadLangs: false,
                }),
            ],
            providers: [TranslatedPaginatorIntl],
        });
        const intl = TestBed.inject(TranslatedPaginatorIntl);
        let changes = 0;
        intl.changes.subscribe(() => changes++);

        await firstValueFrom(TestBed.inject(TranslocoService).load('en'));

        expect(intl.itemsPerPageLabel).toBe(en.common.paginator.items_per_page);
        expect(intl.nextPageLabel).toBe(en.common.paginator.next_page);
        expect(changes).toBeGreaterThan(0);
        expect(intl.getRangeLabel(0, 10, 47)).not.toContain('common.paginator');
    });
});
