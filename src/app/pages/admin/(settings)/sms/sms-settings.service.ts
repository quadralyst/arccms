/**
 * Settings, SMS: `Settings/sms` (admin only) and the test send.
 * The MSG91 auth key is never read back into the page, only whether one is set.
 */
import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Firestore, doc, getDoc, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { arcCallable } from '../../../../core/config/arc-functions';

export type SmsProviderId = 'log' | 'msg91';

export interface SmsSettingsForm {
    provider: SmsProviderId;
    defaultCountryCode: string;
    /** Comma-separated for the form, e.g. `91` or `91, 44`. */
    allowedCountryCodes: string;
    /** Empty means "keep the saved key". */
    msg91AuthKey: string;
    msg91OtpTemplateId: string;
    /** Test provider only: the sign-in page also shows PIN reset codes. */
    showResetCodes: boolean;
}

export const DEFAULT_SMS_FORM: SmsSettingsForm = {
    provider: 'log',
    defaultCountryCode: '91',
    allowedCountryCodes: '91',
    msg91AuthKey: '',
    msg91OtpTemplateId: '',
    showResetCodes: false,
};

/** `+91, 44 ,x` → `['91', '44']` */
export function parseCountryCodes(text: string): string[] {
    return text.split(',').map((code) => code.replace(/\D/g, '')).filter(Boolean);
}

/** What `save` writes to `Settings/sms`, before the timestamp. */
export function smsSettingsData(form: SmsSettingsForm): Record<string, unknown> {
    const defaultCountryCode = form.defaultCountryCode.replace(/\D/g, '') || DEFAULT_SMS_FORM.defaultCountryCode;
    const allowed = parseCountryCodes(form.allowedCountryCodes);
    const data: Record<string, unknown> = {
        provider: form.provider,
        defaultCountryCode,
        // Empty means the default country only (functions/src/sms/smsSettings.ts).
        allowedCountryCodes: allowed.length ? allowed : [defaultCountryCode],
        msg91OtpTemplateId: form.msg91OtpTemplateId.trim(),
        // Leaving test mode turns it off, so coming back to it asks again.
        showResetCodes: form.provider === 'log' && form.showResetCodes,
    };
    if (form.msg91AuthKey.trim()) data['msg91AuthKey'] = form.msg91AuthKey.trim();
    return data;
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
        const allowed = Array.isArray(data['allowedCountryCodes']) ? (data['allowedCountryCodes'] as string[]).join(', ') : DEFAULT_SMS_FORM.allowedCountryCodes;
        return {
            form: {
                provider: data['provider'] === 'msg91' ? 'msg91' : 'log',
                defaultCountryCode: String(data['defaultCountryCode'] ?? DEFAULT_SMS_FORM.defaultCountryCode),
                allowedCountryCodes: allowed,
                msg91AuthKey: '',
                msg91OtpTemplateId: String(data['msg91OtpTemplateId'] ?? ''),
                showResetCodes: data['showResetCodes'] === true,
            },
            hasAuthKey: !!data['msg91AuthKey'],
            phoneSignIn: users?.data()?.['phoneSignIn'] === true,
        };
    }

    async save(form: SmsSettingsForm): Promise<void> {
        const data = { ...smsSettingsData(form), updatedAt: serverTimestamp() };
        await this.inCtx(() => setDoc(doc(this.firestore, 'Settings', 'sms'), data, { merge: true }));
    }

    async sendTest(phone: string): Promise<{ status: string; error?: string }> {
        const result = await this.inCtx(() => arcCallable(this.functions, 'sendTestSms')({ phone }));
        return result.data as { status: string; error?: string };
    }
}
