/**
 * Settings, SMS: `Settings/sms` (admin only) and the test send.
 * The MSG91 auth key is never read back into the page, only whether one is set.
 * The countries are copied to `Settings/users` (`phoneCountry`, `phoneCountryCode`,
 * `phoneCountries`), which the sign-in page can read, so its country chip offers
 * what the server takes (specs/phone-country-spec.md).
 */
import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Firestore, doc, getDoc, serverTimestamp, setDoc, writeBatch } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { arcCallable } from '../../../../core/config/arc-functions';
import { codesOf, countryByIso, DEFAULT_COUNTRY, resolveCountrySettings } from '../../../../../shared/data/countries';

export type SmsProviderId = 'log' | 'msg91';

export interface SmsSettingsForm {
    provider: SmsProviderId;
    /** ISO id (`IN`): the country the chip starts on, and numbers typed without a code. */
    defaultCountry: string;
    /** ISO ids: the only countries people can sign in from (specs/phone-country-spec.md). */
    allowedCountries: string[];
    /** Empty means "keep the saved key". */
    msg91AuthKey: string;
    msg91OtpTemplateId: string;
    /** Test provider only: the sign-in page also shows PIN reset codes. */
    showResetCodes: boolean;
}

export const DEFAULT_SMS_FORM: SmsSettingsForm = {
    provider: 'log',
    defaultCountry: DEFAULT_COUNTRY,
    allowedCountries: [DEFAULT_COUNTRY],
    msg91AuthKey: '',
    msg91OtpTemplateId: '',
    showResetCodes: false,
};

/** The countries the form's choices come to: never none, the default always among them. */
function formCountries(form: SmsSettingsForm): { country: string; countries: string[] } {
    return resolveCountrySettings({ countries: form.allowedCountries, country: form.defaultCountry });
}

/**
 * What `save` writes to `Settings/sms`, before the timestamp: the countries, and
 * their calling codes, which the server reads (functions/src/sms/smsSettings.ts).
 */
export function smsSettingsData(form: SmsSettingsForm): Record<string, unknown> {
    const { country, countries } = formCountries(form);
    const data: Record<string, unknown> = {
        provider: form.provider,
        defaultCountry: country,
        allowedCountries: countries,
        defaultCountryCode: countryByIso(country)!.code,
        allowedCountryCodes: codesOf(countries),
        msg91OtpTemplateId: form.msg91OtpTemplateId.trim(),
        // Leaving test mode turns it off, so coming back to it asks again.
        showResetCodes: form.provider === 'log' && form.showResetCodes,
    };
    if (form.msg91AuthKey.trim()) data['msg91AuthKey'] = form.msg91AuthKey.trim();
    return data;
}

/**
 * The sign-in page's copy in `Settings/users` (public read; `Settings/sms` is
 * admin only): the default country, its code, and the allowed countries.
 */
export function publicCountryCopy(stored: { country: string; countries: string[] }): Record<string, unknown> {
    return {
        phoneCountry: stored.country,
        phoneCountryCode: countryByIso(stored.country)!.code,
        phoneCountries: stored.countries,
    };
}

function sameCopy(copy: Record<string, unknown> | undefined, wanted: Record<string, unknown>): boolean {
    return Object.entries(wanted).every(([key, value]) => JSON.stringify(copy?.[key]) === JSON.stringify(value));
}

@Injectable({ providedIn: 'root' })
export class SmsSettingsService {
    private readonly firestore = inject(Firestore);
    private readonly functions = inject(Functions);
    private readonly injector = inject(Injector);

    private inCtx<T>(fn: () => Promise<T>): Promise<T> {
        return runInInjectionContext(this.injector, fn);
    }

    /**
     * The form values, whether an auth key is saved, and whether phone sign-in is on
     * (`Settings/users.phoneSignIn`, switched in User Settings), so the page can say so.
     */
    async load(): Promise<{ form: SmsSettingsForm; hasAuthKey: boolean; phoneSignIn: boolean }> {
        const [snap, users] = await Promise.all([
            this.inCtx(() => getDoc(doc(this.firestore, 'Settings', 'sms'))),
            this.inCtx(() => getDoc(doc(this.firestore, 'Settings', 'users'))).catch(() => null),
        ]);
        const data = snap.data() ?? {};
        const stored = resolveCountrySettings({
            countries: data['allowedCountries'],
            codes: data['allowedCountryCodes'],
            country: data['defaultCountry'],
            code: data['defaultCountryCode'],
        });
        // Keep the sign-in page's copy in step: saved before the copy existed, or
        // changed outside this page (a script, the console).
        const copy = publicCountryCopy(stored);
        if (snap.exists() && users && !sameCopy(users.data(), copy)) {
            await this.inCtx(() => setDoc(doc(this.firestore, 'Settings', 'users'), copy, { merge: true })).catch(() => undefined);
        }
        return {
            form: {
                provider: data['provider'] === 'msg91' ? 'msg91' : 'log',
                defaultCountry: stored.country,
                allowedCountries: stored.countries,
                msg91AuthKey: '',
                msg91OtpTemplateId: String(data['msg91OtpTemplateId'] ?? ''),
                showResetCodes: data['showResetCodes'] === true,
            },
            hasAuthKey: !!data['msg91AuthKey'],
            phoneSignIn: users?.data()?.['phoneSignIn'] === true,
        };
    }

    /** Both documents in one write, so the sign-in page never disagrees with the server. */
    async save(form: SmsSettingsForm): Promise<void> {
        const fields = smsSettingsData(form);
        await this.inCtx(() => {
            const batch = writeBatch(this.firestore);
            batch.set(doc(this.firestore, 'Settings', 'sms'), { ...fields, updatedAt: serverTimestamp() }, { merge: true });
            batch.set(doc(this.firestore, 'Settings', 'users'), publicCountryCopy(formCountries(form)), { merge: true });
            return batch.commit();
        });
    }

    async sendTest(phone: string): Promise<{ status: string; error?: string }> {
        const result = await this.inCtx(() => arcCallable(this.functions, 'sendTestSms')({ phone }));
        return result.data as { status: string; error?: string };
    }
}
