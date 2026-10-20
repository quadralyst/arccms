/**
 * The app's templates in Email, Composer (specs/app-email-spec.md, AE-D3, AE-D13):
 * a preview per language, filled with the template's sample data.
 */
import { describe, expect, it } from 'vitest';
import { fillSample, previewLanguages } from './email-composer.page';

describe('app templates in the composer', () => {
    it('preview an app template in each of its languages', () => {
        expect(previewLanguages({
            owner: 'app', subject: 'Closing', template: '<p>en</p>', language: 'en',
            languages: { en: { subject: 'Closing', template: '<p>en</p>' }, de: { subject: 'Abschluss', template: '<p>de</p>' } },
        })).toEqual([
            { code: 'en', subject: 'Closing', html: '<p>en</p>' },
            { code: 'de', subject: 'Abschluss', html: '<p>de</p>' },
        ]);
    });

    it('preview an account email in English and the languages the app added', () => {
        expect(previewLanguages({ subject: 'Your code', template: '<p>##OTP##</p>', languages: { de: { subject: 'Ihr Code', template: '<p>de</p>' } } }))
            .toEqual([{ code: 'en', subject: 'Your code', html: '<p>##OTP##</p>' }, { code: 'de', subject: 'Ihr Code', html: '<p>de</p>' }]);
        expect(previewLanguages({ subject: 'One language', template: 'x' })).toEqual([]);
    });

    it('fill the sample data as text, and leave tags without a sample', () => {
        expect(fillSample('##DATE## <b>##TOTAL##</b> ##COMPANY_NAME##', { DATE: '20 Oct', TOTAL: '<5>' }))
            .toBe('20 Oct <b>&lt;5&gt;</b> ##COMPANY_NAME##');
        expect(fillSample('##DATE##', undefined)).toBe('##DATE##');
    });
});
