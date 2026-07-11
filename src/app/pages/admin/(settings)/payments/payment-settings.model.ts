/**
 * Dodo Payments settings model (Settings/dodo-payments document).
 * Secret values are masked on read and only persisted when a new value is entered.
 */
export interface IDodoPaymentSettings {
    enabled: boolean;
    mode: 'test' | 'live';
    testApiKey: string;
    liveApiKey: string;
    webhookSecret: string;
    successUrl: string;
    cancelUrl: string;
}

export const MASKED_VALUE = '••••••••';

export const DEFAULT_DODO_PAYMENT_SETTINGS: IDodoPaymentSettings = {
    enabled: false,
    mode: 'test',
    testApiKey: '',
    liveApiKey: '',
    webhookSecret: '',
    successUrl: '',
    cancelUrl: '',
};
