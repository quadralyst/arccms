import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { SignInMethodsComponent } from './sign-in-methods.component';
import { english } from '../../../../test/english';
import { SentCodes } from '../sent-codes';

const proto = SignInMethodsComponent.prototype as unknown as Record<string, (this: unknown, ...args: unknown[]) => Promise<void>>;

/** A stand-in for the component: its signals plus mocked services. */
function ctx(check: Record<string, unknown> = { status: 'available' }, countryCode = '91', countries: string[] = [], listed = true) {
    const country = ({ '91': 'IN', '44': 'GB', '1': 'US' } as Record<string, string>)[countryCode];
    const c: Record<string, any> = {
        t: english,
        lang: () => 'en',
        countryCode: signal(countryCode),
        phoneCountries: signal(countries.length ? countries : [country]),
        countriesListed: signal(listed),
        phoneCountry: signal(country),
        flow: signal<any>(null),
        busy: signal(false),
        error: signal(''),
        message: signal(''),
        secret: signal(''),
        testCodeInLogs: signal(false),
        notice: signal(''),
        resendIn: signal(0),
        sentCodes: new SentCodes(),
        startCountdown: vi.fn(),
        changingPin: signal(false),
        codeBoxes: () => ({ reset: vi.fn(), value: () => '' }),
        toast: { success: vi.fn() },
        authStore: { refreshCurrentUser: vi.fn().mockResolvedValue(null) },
        signIn: {
            checkForLink: vi.fn().mockResolvedValue({ kind: 'phone', value: '+919876543210', needsPin: false, ...check }),
            requestPhoneCode: vi.fn().mockResolvedValue({ sent: true }),
            requestEmailLinkCode: vi.fn().mockResolvedValue({ sent: true }),
            verifyPhoneCode: vi.fn().mockResolvedValue({ verified: true }),
            verifyEmailLinkCode: vi.fn().mockResolvedValue({ verified: true }),
            linkPhone: vi.fn().mockResolvedValue({ moved: false }),
            linkEmail: vi.fn().mockResolvedValue({ moved: false }),
        },
    };
    for (const name of ['run', 'requestCode', 'finish', 'reset', 'typedPhone', 'phoneError']) c[name] = (proto as any)[name].bind(c);
    return c;
}

describe('SignInMethodsComponent', () => {
    it('sends the code straight away for a free number', async () => {
        const c = ctx();
        c['flow'].set({ kind: 'phone', step: 'enter', typed: '98765 43210', check: null });
        await proto['sendCode'].call(c);
        expect(c['signIn'].requestPhoneCode).toHaveBeenCalledWith('+919876543210', 'link');
        expect(c['flow']().step).toBe('code');
    });

    it('reads a number against the site\'s default country code (Settings, SMS)', async () => {
        const c = ctx({ value: '+447700900123' }, '44');
        c['flow'].set({ kind: 'phone', step: 'enter', typed: '07700 900123', check: null });
        await proto['sendCode'].call(c);
        expect(c['error']()).toBe('');
        expect(c['signIn'].requestPhoneCode).toHaveBeenCalledWith('+447700900123', 'link');
    });

    it('checks the number with its country code, from the country beside the box', async () => {
        const c = ctx({ value: '+447700900123' }, '91', ['IN', 'GB']);
        c['phoneCountry'].set('GB');
        c['flow'].set({ kind: 'phone', step: 'enter', typed: '07700 900123', check: null });
        await proto['sendCode'].call(c);
        expect(c['signIn'].checkForLink).toHaveBeenCalledWith('+447700900123');
    });

    it('turns down a number from a country the site does not take, naming the ones it does', async () => {
        const c = ctx();
        c['flow'].set({ kind: 'phone', step: 'enter', typed: '+44 7700 900123', check: null });
        await proto['sendCode'].call(c);
        expect(c['error']()).toBe('This site takes mobile numbers from India only.');
        expect(c['signIn'].checkForLink).not.toHaveBeenCalled();
    });

    it('leaves a number with its own code to the server when the list is not known', async () => {
        const c = ctx({ value: '+447700900123' }, '91', [], false);
        c['flow'].set({ kind: 'phone', step: 'enter', typed: '+44 7700 900123', check: null });
        await proto['sendCode'].call(c);
        expect(c['signIn'].checkForLink).toHaveBeenCalledWith('+447700900123');
    });

    it('moves a pasted number\'s code to the chip', async () => {
        const c = ctx({}, '91', ['IN', 'GB']);
        c['setTyped'] = (proto as any)['setTyped'].bind(c);
        c['flow'].set({ kind: 'phone', step: 'enter', typed: '+44 7700 900123', check: null });
        (proto as any)['cleanTyped'].call(c);
        await new Promise((r) => setTimeout(r));
        expect(c['phoneCountry']()).toBe('GB');
        expect(c['flow']().typed).toBe('7700900123');
    });

    it('says what is wrong with a number, as the sign-in page does', async () => {
        const c = ctx();
        c['flow'].set({ kind: 'phone', step: 'enter', typed: '1234567890', check: null });
        await proto['sendCode'].call(c);
        expect(c['error']()).toMatch(/start with 6, 7, 8 or 9/);
        expect(c['signIn'].checkForLink).not.toHaveBeenCalled();
    });

    it('says a number is on another account first, and sends the code on the next press', async () => {
        const c = ctx({ status: 'other' });
        c['flow'].set({ kind: 'phone', step: 'enter', typed: '98765 43210', check: null });
        await proto['sendCode'].call(c);
        expect(c['flow']().check.status).toBe('other');
        expect(c['flow']().step).toBe('enter');
        expect(c['signIn'].requestPhoneCode).not.toHaveBeenCalled();

        await proto['sendCode'].call(c);
        expect(c['signIn'].requestPhoneCode).toHaveBeenCalledTimes(1);
        expect(c['flow']().step).toBe('code');
    });

    it('with the Simulated email provider, says the code is in Email Logs', async () => {
        const c = ctx({ kind: 'email', value: 'new@example.com', needsPassword: false });
        c['signIn'].requestEmailLinkCode.mockResolvedValue({ sent: true, testMode: true });
        c['flow'].set({ kind: 'email', step: 'enter', typed: 'new@example.com', check: null });
        await proto['sendCode'].call(c);
        expect(c['signIn'].requestEmailLinkCode).toHaveBeenCalledWith('new@example.com');
        expect(c['testCodeInLogs']()).toBe(true);
    });

    it('says nothing about logs when the email really went out', async () => {
        const c = ctx({ kind: 'email', value: 'new@example.com', needsPassword: false });
        c['flow'].set({ kind: 'email', step: 'enter', typed: 'new@example.com', check: null });
        await proto['sendCode'].call(c);
        expect(c['testCodeInLogs']()).toBe(false);
    });

    it('refuses a number that is already yours without sending anything', async () => {
        const c = ctx({ status: 'yours' });
        c['flow'].set({ kind: 'phone', step: 'enter', typed: '98765 43210', check: null });
        await proto['sendCode'].call(c);
        expect(c['error']()).toBe('This number is already on your account.');
        expect(c['signIn'].requestPhoneCode).not.toHaveBeenCalled();
    });

    it('asks for a PIN after the code when the account has none, then links with it', async () => {
        const c = ctx({ needsPin: true });
        c['flow'].set({ kind: 'phone', step: 'code', typed: '98765 43210', check: { kind: 'phone', value: '+919876543210', status: 'available', needsPin: true } });
        await proto['verifyCode'].call(c, '123456');
        expect(c['flow']().step).toBe('secret');

        c['secret'].set('246810');
        await proto['finish'].call(c);
        expect(c['signIn'].linkPhone).toHaveBeenCalledWith('+919876543210', '246810');
        expect(c['message']()).toBe('Phone number saved.');
        expect(c['flow']()).toBeNull();
    });

    it('links an email right after the code when a password is already set, and says when it moved', async () => {
        const c = ctx();
        c['signIn'].linkEmail.mockResolvedValue({ moved: true });
        c['flow'].set({ kind: 'email', step: 'code', typed: 'a@b.co', check: { kind: 'email', value: 'a@b.co', status: 'other', needsPassword: false } });
        await proto['verifyCode'].call(c, '123456');
        expect(c['signIn'].verifyEmailLinkCode).toHaveBeenCalledWith('a@b.co', '123456');
        expect(c['signIn'].linkEmail).toHaveBeenCalledWith('a@b.co', undefined);
        expect(c['message']()).toBe('Email moved to this account.');
        expect(c['authStore'].refreshCurrentUser).toHaveBeenCalled();
    });

    it('shows a wrong code in place and keeps the flow open', async () => {
        const c = ctx();
        c['signIn'].verifyPhoneCode.mockRejectedValue({ code: 'functions/invalid-argument', message: "That code didn't work." });
        c['flow'].set({ kind: 'phone', step: 'code', typed: '', check: { kind: 'phone', value: '+919876543210', status: 'available' } });
        await proto['verifyCode'].call(c, '000000');
        expect(c['error']()).toBe("That code didn't work.");
        expect(c['flow']().step).toBe('code');
    });

    describe('a code already asked for (specs/sign-in-codes-spec.md)', () => {
        it('starting again with the same number goes to the code boxes without sending, and keeps the countdown', async () => {
            const c = ctx();
            c['flow'].set({ kind: 'phone', step: 'enter', typed: '98765 43210', check: null });
            await proto['sendCode'].call(c);
            expect(c['signIn'].requestPhoneCode).toHaveBeenCalledTimes(1);
            expect(c['startCountdown']).toHaveBeenLastCalledWith(60);

            c['flow'].set({ kind: 'phone', step: 'enter', typed: '98765 43210', check: null });
            await proto['sendCode'].call(c);
            expect(c['signIn'].requestPhoneCode).toHaveBeenCalledTimes(1);
            expect(c['flow']().step).toBe('code');
            expect(c['startCountdown'].mock.calls.at(-1)[0]).toBeGreaterThan(55);
        });

        it('turns "please wait" into the countdown with a quiet line, and goes to the code boxes', async () => {
            const c = ctx();
            c['signIn'].requestPhoneCode.mockRejectedValue({ code: 'functions/resource-exhausted', message: 'Please wait 39s', details: { reason: 'wait', wait: 39 } });
            c['flow'].set({ kind: 'phone', step: 'enter', typed: '98765 43210', check: null });
            await proto['sendCode'].call(c);
            expect(c['startCountdown']).toHaveBeenLastCalledWith(39);
            expect(c['notice']()).toMatch(/sent a code a moment ago/);
            expect(c['error']()).toBe('');
            expect(c['flow']().step).toBe('code');
        });

        it('waits for the countdown before Resend', async () => {
            const c = ctx();
            c['resendIn'].set(20);
            c['flow'].set({ kind: 'phone', step: 'code', typed: '', check: { kind: 'phone', value: '+919876543210', status: 'available' } });
            await proto['resend'].call(c);
            expect(c['signIn'].requestPhoneCode).not.toHaveBeenCalled();
        });
    });
});
