/**
 * Rule emails and the templates other features fill (App audience test, 2026-09-29:
 * a rule using "Generic Notification" sent a blank subject and body).
 */
import { describe, expect, it } from 'vitest';
import { isRuleEmailTemplate, NOT_FOR_RULES } from './automations-settings.page';
import { RULE_EMAIL_EXCLUDED_TEMPLATES } from '../../../../../../functions/src/email-core/appEvents';

describe('templates offered in rules', () => {
    it('leaves out codes, notifications and the admin digest, and keeps the rest', () => {
        expect(isRuleEmailTemplate('notification_generic_email')).toBe(false);
        expect(isRuleEmailTemplate('signup_otp_email')).toBe(false);
        expect(isRuleEmailTemplate('app_user_upgraded')).toBe(true);
        expect(isRuleEmailTemplate('payment_succeeded_email')).toBe(true);
        expect(isRuleEmailTemplate('')).toBe(false);
    });

    it('matches what the server refuses to send from a rule', () => {
        expect([...NOT_FOR_RULES].sort()).toEqual([...RULE_EMAIL_EXCLUDED_TEMPLATES].sort());
    });
});
