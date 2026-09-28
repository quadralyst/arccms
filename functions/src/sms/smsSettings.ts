/**
 * SMS settings (`Settings/sms`), shared by every feature that sends a text.
 *
 * With no document the provider is `log`: nothing leaves the system and every
 * message is written to `SmsLogs`, so a new site can exercise phone sign-in
 * before it has an SMS account. The MSG91 auth key is admin-only like every
 * other `Settings` field and is masked when the admin page reads it back.
 */
import { db } from '../init.js';
import { DEFAULT_COUNTRY_CODE } from '../auth/phoneNumber.js';

export const SMS_PROVIDERS = ['log', 'msg91'] as const;
export type SmsProviderId = (typeof SMS_PROVIDERS)[number];

export interface SmsSettings {
    provider: SmsProviderId;
    /** Country code added to numbers typed without one. Digits only, e.g. `91`. */
    defaultCountryCode: string;
    /** Numbers outside these codes are refused, so nobody can run up an SMS bill abroad. */
    allowedCountryCodes: string[];
    msg91AuthKey: string;
    /** The DLT-approved MSG91 OTP template; it must contain `##OTP##`. */
    msg91OtpTemplateId: string;
}

export const DEFAULT_SMS_SETTINGS: SmsSettings = {
    provider: 'log',
    defaultCountryCode: DEFAULT_COUNTRY_CODE,
    allowedCountryCodes: [DEFAULT_COUNTRY_CODE],
    msg91AuthKey: '',
    msg91OtpTemplateId: '',
};

function digits(value: unknown): string {
    return String(value ?? '').replace(/\D/g, '');
}

/** Stored settings with every gap filled from the defaults. */
export function resolveSmsSettings(raw: Record<string, unknown> | undefined): SmsSettings {
    const data = raw ?? {};
    const provider = SMS_PROVIDERS.includes(data['provider'] as SmsProviderId)
        ? (data['provider'] as SmsProviderId)
        : DEFAULT_SMS_SETTINGS.provider;
    const defaultCountryCode = digits(data['defaultCountryCode']) || DEFAULT_SMS_SETTINGS.defaultCountryCode;
    const listed = Array.isArray(data['allowedCountryCodes'])
        ? (data['allowedCountryCodes'] as unknown[]).map(digits).filter(Boolean)
        : [];
    // No list (or an emptied one) means the default country only, never everywhere.
    const allowed = listed.length ? listed : [defaultCountryCode];
    return {
        provider,
        defaultCountryCode,
        allowedCountryCodes: allowed,
        msg91AuthKey: typeof data['msg91AuthKey'] === 'string' ? data['msg91AuthKey'].trim() : '',
        msg91OtpTemplateId: typeof data['msg91OtpTemplateId'] === 'string' ? data['msg91OtpTemplateId'].trim() : '',
    };
}

export async function readSmsSettings(): Promise<SmsSettings> {
    const snap = await db.collection('Settings').doc('sms').get();
    return resolveSmsSettings(snap.data());
}
