/**
 * SMS providers. Each one takes a message and either delivers it or throws.
 *
 * `log` delivers nothing: `sendSms` records the full text in `SmsLogs`, which is
 * how codes are read while testing. `msg91` uses MSG91's OTP API, which sends
 * the site's DLT-approved template with the code in `##OTP##` (Indian
 * regulation allows only registered templates, so free text cannot be sent).
 */
import type { SmsProviderId, SmsSettings } from './smsSettings.js';

export type SmsPurpose = 'otp' | 'test';

export interface SmsMessage {
    /** E.164, e.g. `+919876543210`. */
    to: string;
    purpose: SmsPurpose;
    /** What the person would read. Kept in full only by the `log` provider. */
    text: string;
    /** The one-time code, for providers that fill it into a template. */
    code?: string;
}

export interface SmsDelivery {
    providerMessageId?: string;
}

export interface SmsProvider {
    id: SmsProviderId;
    /** A real provider: its log entries never hold the code. */
    delivers: boolean;
    send(message: SmsMessage, settings: SmsSettings): Promise<SmsDelivery>;
}

export const logProvider: SmsProvider = {
    id: 'log',
    delivers: false,
    async send() {
        return {};
    },
};

export const MSG91_OTP_URL = 'https://control.msg91.com/api/v5/otp';

/** The request MSG91's OTP API expects. Pure, so it is tested without the network. */
export function buildMsg91OtpRequest(message: SmsMessage, settings: SmsSettings): { url: string; init: RequestInit } {
    const params = new URLSearchParams({
        template_id: settings.msg91OtpTemplateId,
        mobile: message.to.replace(/^\+/, ''),
        otp: message.code ?? '',
    });
    return {
        url: `${MSG91_OTP_URL}?${params.toString()}`,
        init: {
            method: 'POST',
            headers: { authkey: settings.msg91AuthKey, 'Content-Type': 'application/json', accept: 'application/json' },
            body: '{}',
        },
    };
}

export const msg91Provider: SmsProvider = {
    id: 'msg91',
    delivers: true,
    async send(message, settings) {
        if (!settings.msg91AuthKey || !settings.msg91OtpTemplateId) {
            throw new Error('MSG91 is not set up: add the auth key and the OTP template id in Settings, SMS.');
        }
        if (!message.code) throw new Error('MSG91 sends only one-time codes.');
        const { url, init } = buildMsg91OtpRequest(message, settings);
        const response = await fetch(url, init);
        const body = (await response.json().catch(() => ({}))) as { type?: string; message?: string; request_id?: string };
        if (!response.ok || body.type !== 'success') {
            throw new Error(`MSG91: ${body.message || `HTTP ${response.status}`}`);
        }
        return { providerMessageId: body.request_id || body.message };
    },
};

export const SMS_PROVIDER_REGISTRY: Record<SmsProviderId, SmsProvider> = {
    log: logProvider,
    msg91: msg91Provider,
};
