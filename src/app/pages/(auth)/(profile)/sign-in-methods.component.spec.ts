import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { SignInMethodsComponent } from './sign-in-methods.component';
import { english } from '../../../../test/english';
import { SentCodes } from '../sent-codes';
import { NEVER } from 'rxjs';
import { SIGN_IN_SETTINGS_CACHE_KEY } from '../../admin/(settings)/user-setting/user-setting.service';

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
        secretAgain: signal(''),
        // The two rows of a new PIN: what check() finds in them (the rows themselves are new-pin-input.component.spec.ts).
        newPinField: () => newPin,
        testCodeInLogs: signal(false),
        notice: signal(''),
        resendIn: signal(0),
        sentCodes: new SentCodes(),
        startCountdown: vi.fn(),
        changingPin: signal(false),
        hasCurrentPin: signal(false),
        currentPin: signal(''),
        currentPinBoxes: () => currentBoxes,
        codeBoxes: () => ({ reset: vi.fn(), value: () => '' }),
        toast: { success: vi.fn() },
        // No email or number yet: no fresh code (the tests below that need one set it).
        user: signal<any>({ email: '' }),
        freshCode: { confirm: vi.fn().mockResolvedValue('proof-1') },
        authStore: { refreshCurrentUser: vi.fn().mockResolvedValue(null), currentUser: () => ({ name: 'Asha Rao' }) },
        signIn: {
            checkForLink: vi.fn().mockResolvedValue({ kind: 'phone', value: '+919876543210', needsPin: false, ...check }),
            requestPhoneCode: vi.fn().mockResolvedValue({ sent: true }),
            requestEmailLinkCode: vi.fn().mockResolvedValue({ sent: true }),
            verifyPhoneCode: vi.fn().mockResolvedValue({ verified: true }),
            verifyEmailLinkCode: vi.fn().mockResolvedValue({ verified: true }),
            linkPhone: vi.fn().mockResolvedValue({ moved: false }),
            linkEmail: vi.fn().mockResolvedValue({ moved: false }),
            hasPin: vi.fn().mockResolvedValue(false),
        },
    };
    for (const name of ['run', 'requestCode', 'finish', 'reset', 'typedPhone', 'phoneError', 'readNewPin', 'pinRefused', 'needsFreshCode', 'askFreshCode']) c[name] = (proto as any)[name].bind(c);
    return c;
}

/** The new-PIN rows in the stand-in: both hold `pin`, or `again` differs. */
let newPin: { check: ReturnType<typeof vi.fn>; restart: ReturnType<typeof vi.fn> };
/** The current PIN row in the stand-in. */
let currentBoxes = { reset: vi.fn(), focus: vi.fn() };
beforeEach(() => { currentBoxes = { reset: vi.fn(), focus: vi.fn() }; });

function rowsHold(pin: string, again = pin): void {
    newPin = {
        check: vi.fn(() => (again === pin ? { pin } : { problem: 'member.auth.pins_mismatch' })),
        restart: vi.fn(),
    };
}
beforeEach(() => rowsHold(''));

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

        // Typed twice: two that differ link nothing.
        rowsHold('246810', '246801');
        await proto['finish'].call(c);
        expect(c['signIn'].linkPhone).not.toHaveBeenCalled();
        expect(c['error']()).toBe(english('member.auth.pins_mismatch'));

        rowsHold('246810');
        await proto['finish'].call(c);
        expect(c['signIn'].linkPhone).toHaveBeenCalledWith('+919876543210', '246810', undefined);
        expect(c['message']()).toBe('Phone number saved.');
        expect(c['flow']()).toBeNull();
    });

    it('links an email right after the code when a password is already set, and says when it moved', async () => {
        const c = ctx();
        c['signIn'].linkEmail.mockResolvedValue({ moved: true });
        c['flow'].set({ kind: 'email', step: 'code', typed: 'a@b.co', check: { kind: 'email', value: 'a@b.co', status: 'other', needsPassword: false } });
        await proto['verifyCode'].call(c, '123456');
        expect(c['signIn'].verifyEmailLinkCode).toHaveBeenCalledWith('a@b.co', '123456');
        expect(c['signIn'].linkEmail).toHaveBeenCalledWith('a@b.co', undefined, undefined);
        expect(c['message']()).toBe('Email moved to this account.');
        expect(c['authStore'].refreshCurrentUser).toHaveBeenCalled();
    });

    describe('an account with a way in already confirms it is them first (fresh code)', () => {
        it('asks for the fresh code before any code goes to the new number, and links with its proof', async () => {
            const c = ctx();
            c['user'].set({ email: 'asha@example.com' });
            c['flow'].set({ kind: 'phone', step: 'enter', typed: '98765 43210', check: null });
            await proto['sendCode'].call(c);
            expect(c['freshCode'].confirm).toHaveBeenCalledWith({ purpose: 'link-phone' });
            expect(c['freshCode'].confirm.mock.invocationCallOrder[0]).toBeLessThan(c['signIn'].requestPhoneCode.mock.invocationCallOrder[0]);
            expect(c['flow']()).toMatchObject({ step: 'code', proof: 'proof-1' });

            await proto['verifyCode'].call(c, '123456');
            expect(c['signIn'].linkPhone).toHaveBeenCalledWith('+919876543210', undefined, 'proof-1');
            expect(c['message']()).toBe('Phone number saved.');
        });

        it('sends nothing to the new address when the fresh code is cancelled, and says why', async () => {
            const c = ctx({ kind: 'email', value: 'new@example.com' });
            c['user'].set({ email: '', phone: '+919811112222' });
            c['freshCode'].confirm.mockResolvedValue(null);
            c['flow'].set({ kind: 'email', step: 'enter', typed: 'new@example.com', check: null });
            await proto['sendCode'].call(c);
            expect(c['freshCode'].confirm).toHaveBeenCalledWith({ purpose: 'link-email' });
            expect(c['signIn'].requestEmailLinkCode).not.toHaveBeenCalled();
            expect(c['flow']().step).toBe('enter');
            expect(c['error']()).toBe(english('member.methods.fresh_code_needed'));
        });

        it('asks again and retries once when the server says the proof ran out', async () => {
            const c = ctx();
            c['signIn'].linkEmail
                .mockRejectedValueOnce({ code: 'functions/permission-denied', message: 'x', details: { reason: 'fresh-code-required' } })
                .mockResolvedValueOnce({ moved: false });
            c['freshCode'].confirm.mockResolvedValue('proof-2');
            c['flow'].set({ kind: 'email', step: 'code', typed: 'a@b.co', proof: 'proof-1', check: { kind: 'email', value: 'a@b.co', status: 'available', needsPassword: false } });
            await proto['finish'].call(c);
            expect(c['signIn'].linkEmail.mock.calls.map((call: unknown[]) => call[2])).toEqual(['proof-1', 'proof-2']);
            expect(c['message']()).toBe(english('member.methods.email_saved'));
        });
    });

    it('shows a wrong code in place and keeps the flow open', async () => {
        const c = ctx();
        c['signIn'].verifyPhoneCode.mockRejectedValue({ code: 'functions/invalid-argument', message: "That code didn't work." });
        c['flow'].set({ kind: 'phone', step: 'code', typed: '', check: { kind: 'phone', value: '+919876543210', status: 'available' } });
        await proto['verifyCode'].call(c, '000000');
        expect(c['error']()).toBe("That code didn't work.");
        expect(c['flow']().step).toBe('code');
    });

    it('refuses a first password that is too easy to guess, saying why, before asking the server (F22)', async () => {
        const c = ctx({ kind: 'email', value: 'asha.rao@example.com', status: 'available', needsPassword: true });
        c['flow'].set({ kind: 'email', step: 'secret', typed: '', check: { kind: 'email', value: 'asha.rao@example.com', status: 'available', needsPassword: true } });
        for (const [password, problem] of [['short', 'short'], ['Password123!', 'common'], ['Asha@2024', 'personal']]) {
            c['secret'].set(password);
            c['secretAgain'].set(password);
            await proto['finish'].call(c);
            expect(c['error']()).toBe(english(`member.auth.password_error.${problem}`));
        }
        expect(c['signIn'].linkEmail).not.toHaveBeenCalled();
    });

    it('links an email with a first password only once it is typed the same twice', async () => {
        const c = ctx({ kind: 'email', value: 'asha.rao@example.com', status: 'available', needsPassword: true });
        c['flow'].set({ kind: 'email', step: 'secret', typed: '', check: { kind: 'email', value: 'asha.rao@example.com', status: 'available', needsPassword: true } });
        c['secret'].set('river-lamp-2024');
        c['secretAgain'].set('river-lamp-2042');
        await proto['finish'].call(c);
        expect(c['signIn'].linkEmail).not.toHaveBeenCalled();
        expect(c['error']()).toBe(english('member.auth.passwords_mismatch'));

        c['secretAgain'].set('river-lamp-2024');
        await proto['finish'].call(c);
        expect(c['signIn'].linkEmail).toHaveBeenCalledWith('asha.rao@example.com', 'river-lamp-2024', undefined);
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

        it('a code asked for again inside the minute: the countdown and the quiet line, nothing new sent (F22)', async () => {
            const c = ctx();
            c['signIn'].requestPhoneCode.mockResolvedValue({ sent: true, alreadySent: true, wait: 33 });
            c['flow'].set({ kind: 'phone', step: 'enter', typed: '98765 43210', check: null });
            await proto['sendCode'].call(c);
            expect(c['startCountdown']).toHaveBeenLastCalledWith(33);
            expect(c['notice']()).toMatch(/sent a code a moment ago/);
            expect(c['flow']().step).toBe('code');
        });

        it('waits for the countdown before Resend', async () => {
            const c = ctx();
            c['resendIn'].set(20);
            c['flow'].set({ kind: 'phone', step: 'code', typed: '', check: { kind: 'phone', value: '+919876543210', status: 'available' } });
            await proto['resend'].call(c);
            expect(c['signIn'].requestPhoneCode).not.toHaveBeenCalled();
        });

        it('says Resend sent the same code again (SC-D12)', async () => {
            const c = ctx();
            c['signIn'].requestPhoneCode.mockResolvedValue({ sent: true, sameCode: true });
            c['flow'].set({ kind: 'phone', step: 'code', typed: '', check: { kind: 'phone', value: '+919876543210', status: 'available' } });
            await proto['resend'].call(c);
            expect(c['signIn'].requestPhoneCode).toHaveBeenCalledWith('+919876543210', 'link');
            expect(c['notice']()).toBe('We sent the same code again.');
        });
    });

    it('saves a PIN, and says so when the email account\'s password went with it (specs/sign-in-pin-spec.md)', async () => {
        const c = ctx();
        rowsHold('604175');
        c['signIn'].setPin = vi.fn().mockResolvedValue({ saved: true, passwordRemoved: true });
        await proto['savePin'].call(c);
        expect(c['signIn'].setPin).toHaveBeenCalledWith('604175', undefined);
        expect(c['message']()).toBe('PIN saved. Sign in with it from now on: your password no longer works.');
        c['signIn'].setPin = vi.fn().mockResolvedValue({ saved: true });
        rowsHold('604175');
        await proto['savePin'].call(c);
        expect(c['message']()).toBe(english('member.methods.pin_changed'));
    });

    it('saves no PIN when the two rows differ, and empties both when the server finds it too easy', async () => {
        const c = ctx();
        c['signIn'].setPin = vi.fn().mockResolvedValue({ saved: true });
        rowsHold('604175', '604157');
        await proto['savePin'].call(c);
        expect(c['signIn'].setPin).not.toHaveBeenCalled();
        expect(c['error']()).toBe(english('member.auth.pins_mismatch'));

        rowsHold('111111');
        c['signIn'].setPin = vi.fn().mockRejectedValue({ code: 'functions/invalid-argument', message: 'Too easy.', details: { reason: 'weak-pin' } });
        await proto['savePin'].call(c);
        expect(c['error']()).toBe('Too easy.');
        expect(newPin.restart).toHaveBeenCalled();
    });

    it('changes the PIN from the email row when there is no number', async () => {
        const c = ctx();
        c['pinRow'] = signal('phone');
        await proto['startPinChange'].call(c, 'email');
        expect(c['pinRow']()).toBe('email');
        expect(c['changingPin']()).toBe(true);
    });

    describe('changing a PIN the account has', () => {
        it('asks for the current PIN when the account has one, and none for a first PIN', async () => {
            const c = ctx();
            c['pinRow'] = signal('phone');
            c['signIn'].hasPin.mockResolvedValue(true);
            await proto['startPinChange'].call(c, 'phone');
            expect(c['hasCurrentPin']()).toBe(true);
            expect(c['busy']()).toBe(false);

            c['signIn'].hasPin.mockResolvedValue(false);
            await proto['startPinChange'].call(c, 'phone');
            expect(c['hasCurrentPin']()).toBe(false);
        });

        it('sends the current PIN with the new one, and saves nothing until it is typed', async () => {
            const c = ctx();
            c['hasCurrentPin'].set(true);
            c['signIn'].setPin = vi.fn().mockResolvedValue({ saved: true });
            rowsHold('604175');
            await proto['savePin'].call(c);
            expect(c['signIn'].setPin).not.toHaveBeenCalled();
            expect(c['error']()).toBe(english('member.auth.server_error.current_pin_required'));
            expect(currentBoxes.focus).toHaveBeenCalled();

            c['currentPin'].set('246810');
            await proto['savePin'].call(c);
            expect(c['signIn'].setPin).toHaveBeenCalledWith('604175', '246810');
            expect(c['message']()).toBe(english('member.methods.pin_changed'));
        });

        it('empties the current PIN after a wrong one, and shows the row when the server asks for it', async () => {
            const c = ctx();
            c['hasCurrentPin'].set(true);
            c['currentPin'].set('000000');
            c['signIn'].setPin = vi.fn().mockRejectedValue({ code: 'functions/permission-denied', message: 'Wrong PIN. 4 tries left.', details: { reason: 'wrong', remaining: 4 } });
            rowsHold('604175');
            await proto['savePin'].call(c);
            expect(c['error']()).toBe('Wrong PIN. 4 tries left.');
            expect(c['currentPin']()).toBe('');
            expect(currentBoxes.reset).toHaveBeenCalled();

            c['hasCurrentPin'].set(false);
            c['signIn'].setPin = vi.fn().mockRejectedValue({ code: 'functions/failed-precondition', message: 'Enter your current PIN.', details: { reason: 'current-pin-required' } });
            rowsHold('604175');
            await proto['savePin'].call(c);
            expect(c['hasCurrentPin']()).toBe(true);
        });
    });
});

describe('SignInMethodsComponent first paint', () => {
    it('has the phone and Google rows from the settings the browser kept, before the read answers', () => {
        // The profile page has just read the site's settings and kept them. Waiting for this
        // card's own read added the rows a moment later and pushed the cards under it down.
        localStorage.setItem(SIGN_IN_SETTINGS_CACHE_KEY, JSON.stringify({ isSignupEnabled: true, phoneSignIn: true, googleSignIn: true }));
        try {
            const c: Record<string, any> = {
                googleConnected: signal(false), phoneEnabled: signal(false), googleEnabled: signal(false), emailPin: signal(false),
                countryCode: signal('91'), phoneCountries: signal(['IN']), countriesListed: signal(false), phoneCountry: signal('IN'),
                signIn: { hasGoogle: () => false },
                settings: { getSettings: () => NEVER },
            };
            c['applySettings'] = (proto as any)['applySettings'].bind(c);
            (proto as any)['ngOnInit'].call(c);
            expect(c['phoneEnabled']()).toBe(true);
            expect(c['googleEnabled']()).toBe(true);
        } finally {
            localStorage.removeItem(SIGN_IN_SETTINGS_CACHE_KEY);
        }
    });
});
