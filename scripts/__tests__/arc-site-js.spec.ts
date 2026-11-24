/**
 * arc-site.js, the live parts of a published page (public/assets/js/arc-site.js,
 * specs/own-website-spec.md W5): signup forms through the same callables as the
 * app, plain confirmation panels, counts, the install button and the signed-in hint.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(join(__dirname, '../../public/assets/js/arc-site.js'), 'utf8');
const FUNCTIONS = 'https://us-central1-demo.cloudfunctions.net';
const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/demo/databases/arccms/documents/';

type Responder = (body: Record<string, unknown>) => unknown;

let calls: { name: string; data: Record<string, unknown> }[];
let callables: Record<string, Responder>;
let docs: Record<string, Record<string, unknown> | null>;

const firestoreValue = (v: unknown): Record<string, unknown> =>
    typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) };

function mockFetch(): void {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
        if (url.startsWith(FUNCTIONS)) {
            const name = url.slice(FUNCTIONS.length + '/arccms-'.length);
            const data = JSON.parse(init?.body || '{}').data;
            calls.push({ name, data });
            try {
                const result = callables[name] ? callables[name](data) : {};
                return { ok: true, status: 200, json: async () => ({ result }) };
            } catch (error) {
                const status = (error as { status?: string }).status || 'INVALID_ARGUMENT';
                const reason = (error as { reason?: string }).reason;
                return { ok: false, status: 400, json: async () => ({ error: { message: (error as Error).message, status, ...(reason ? { details: { reason } } : {}) } }) };
            }
        }
        if (url.startsWith(FIRESTORE)) {
            const path = decodeURIComponent(url.slice(FIRESTORE.length));
            const doc = docs[path];
            if (!doc) return { ok: false, status: 404, json: async () => ({}) };
            const fields = Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, firestoreValue(v)]));
            return { ok: true, status: 200, json: async () => ({ fields }) };
        }
        throw new Error(`unexpected fetch ${url}`);
    }));
}

function page(body: string, search = '', head = '', attrs = ''): void {
    history.replaceState({}, '', `/${search}`);
    document.head.innerHTML = head;
    document.body.innerHTML = body
        + `<script src="/assets/js/arc-site.js?v=1" data-functions="${FUNCTIONS}" data-group="arccms" data-project="demo" data-database="arccms"${attrs}></script>`;
    // Run it as the browser would, after the page is parsed.
    new Function(SOURCE)();
}

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

const FORM = '<form data-waitlist-form data-waitlist-id="launch"><input name="email"><input name="firstName"><button type="submit">Join</button></form>';

async function signUp(email = 'Asha@Example.com'): Promise<HTMLFormElement> {
    const form = document.querySelector('form') as HTMLFormElement;
    (form.querySelector('[name="email"]') as HTMLInputElement).value = email;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    return form;
}

beforeEach(() => {
    calls = [];
    localStorage.clear();
    callables = {
        joinForm: () => ({ ticket: 'ticket-1' }),
        requestFormOtp: () => ({ sent: true, status: 'sent' }),
        verifyFormOtp: (d) => { if (d['code'] !== '123456') throw new Error('Wrong code'); return { verified: true }; },
        finalizeFormSignup: () => ({ totalSignups: 42, emailVerified: true }),
        ensureWaitlistExists: () => ({ success: true }),
    };
    docs = {
        'Waitlists/launch': { isActive: true, otpEnabled: true, totalSignups: 42 },
        'Settings/email_status': { isEnabled: true },
    };
    mockFetch();
});

afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { arcSite?: unknown }).arcSite;
});

describe('signup forms', () => {
    it('joins, asks for the emailed code, then shows a plain confirmation', async () => {
        page(FORM);
        await flush();
        const form = await signUp();

        expect(calls.map((c) => c.name)).toEqual(['joinForm', 'requestFormOtp']);
        expect(calls[0].data).toMatchObject({ waitlistId: 'launch', email: 'asha@example.com', firstName: 'Asha', source: 'direct' });
        expect(form.querySelector('.waitlist-verify-step')!.textContent).toContain('asha@example.com');

        (form.querySelector('.waitlist-otp-input') as HTMLInputElement).value = '123456';
        (form.querySelector('.waitlist-verify-btn') as HTMLButtonElement).click();
        await flush();

        expect(calls.map((c) => c.name)).toEqual(['joinForm', 'requestFormOtp', 'verifyFormOtp', 'finalizeFormSignup']);
        // Every step after joining names the signup by its ticket, never by a member id or an address.
        expect(calls[1].data).toEqual({ waitlistId: 'launch', ticket: 'ticket-1' });
        expect(calls[2].data).toEqual({ waitlistId: 'launch', ticket: 'ticket-1', code: '123456' });
        expect(calls[3].data).toEqual({ waitlistId: 'launch', ticket: 'ticket-1' });
        expect(form.querySelector('.waitlist-success-icon')).toBeTruthy();
        expect(form.querySelector('.waitlist-success-title')!.textContent).toBe('You\'re on the list!');
        expect(form.querySelector('.waitlist-success-text')!.textContent).toBe('We\'ll be in touch at asha@example.com.');
        expect(form.querySelector('.waitlist-success-step')!.textContent).not.toContain('42');
    });

    it('says a wrong code in its own words, not the server\'s, and lets the person try again', async () => {
        page(FORM);
        await flush();
        const form = await signUp();
        (form.querySelector('.waitlist-otp-input') as HTMLInputElement).value = '000000';
        (form.querySelector('.waitlist-verify-btn') as HTMLButtonElement).click();
        await flush();
        expect(form.querySelector('.waitlist-inline-message')!.textContent).toBe('Invalid or expired code');
        expect(form.querySelector('.waitlist-otp-input')).toBeTruthy();
    });

    it('maps the server\'s refusals to the page\'s strings by code, never showing its English', async () => {
        const refuse = (status: string, reason?: string) => () => { throw Object.assign(new Error('SERVER ENGLISH'), { status, reason }); };
        const strings = { signup_expired: 'Fill it in again (strings)' };
        const attr = ` data-strings="${JSON.stringify(strings).replace(/"/g, '&quot;')}"`;

        // A ticket refused at the last step: the strings file's line.
        docs['Settings/email_status'] = { isEnabled: false };
        callables['finalizeFormSignup'] = refuse('PERMISSION_DENIED');
        page(FORM, '', '', attr);
        await flush();
        let form = await signUp();
        expect(form.querySelector('[data-waitlist-status]')!.textContent).toBe('Fill it in again (strings)');

        // A closed form, at the first step.
        callables['joinForm'] = refuse('FAILED_PRECONDITION', 'form-closed');
        page(FORM);
        await flush();
        form = await signUp();
        expect(form.querySelector('[data-waitlist-status]')!.textContent).toBe('This form is not taking signups right now.');

        // A resend inside the minute, and a code tried too often.
        docs['Settings/email_status'] = { isEnabled: true };
        callables['joinForm'] = () => ({ ticket: 'ticket-1' });
        page(FORM);
        await flush();
        form = await signUp();
        callables['requestFormOtp'] = refuse('RESOURCE_EXHAUSTED', 'wait');
        (form.querySelector('.waitlist-resend-btn') as HTMLButtonElement).click();
        await flush();
        expect(form.querySelector('.waitlist-inline-message')!.textContent).toBe('Please wait a minute before asking for another code.');
        callables['verifyFormOtp'] = refuse('RESOURCE_EXHAUSTED', 'code-locked');
        (form.querySelector('.waitlist-otp-input') as HTMLInputElement).value = '123456';
        (form.querySelector('.waitlist-verify-btn') as HTMLButtonElement).click();
        await flush();
        expect(form.querySelector('.waitlist-inline-message')!.textContent).toBe('Too many tries. Please ask for a new code.');
        expect(form.textContent).not.toContain('SERVER ENGLISH');
    });

    it('confirms at once when email is off, as the app does', async () => {
        docs['Settings/email_status'] = { isEnabled: false };
        page(FORM);
        await flush();
        const form = await signUp();
        expect(calls.map((c) => c.name)).toEqual(['joinForm', 'requestFormOtp', 'finalizeFormSignup']);
        expect(form.querySelector('.waitlist-success-step')).toBeTruthy();
    });

    // Signup forms have no referrals (specs/form-gamification-spec.md): nothing of
    // them is drawn, sent or kept, and an old ?ref= link just opens the page.
    it('has no referral box, position, copy rows or leaderboard button, and ignores ?ref=', async () => {
        localStorage.setItem('arc_referral', JSON.stringify({ code: 'OLD', expiration: Date.now() + 1e6 }));
        page(FORM, '?ref=FRIEND99');
        await flush();
        expect(localStorage.getItem('arc_referral')).toBeNull();
        let form = await signUp();
        expect(form.querySelector('.waitlist-referral-input')).toBeNull();
        (form.querySelector('.waitlist-otp-input') as HTMLInputElement).value = '123456';
        (form.querySelector('.waitlist-verify-btn') as HTMLButtonElement).click();
        await flush();
        for (const gone of ['.waitlist-stat-number', '.waitlist-copy-input', '.waitlist-copy-btn', '.waitlist-leaderboard-btn']) {
            expect(form.querySelector(gone)).toBeNull();
        }
        expect(calls.some((c) => c.name === 'creditReferral')).toBe(false);
        for (const call of calls) {
            expect(call.data).not.toHaveProperty('referredBy');
            expect(call.data).not.toHaveProperty('referrerCode');
        }
        expect(localStorage.getItem('arc_referral')).toBeNull();

        callables['finalizeFormSignup'] = () => ({ totalSignups: 0, emailVerified: true, alreadyConfirmed: true });
        docs['Settings/email_status'] = { isEnabled: false };
        page(FORM);
        await flush();
        form = await signUp();
        expect(form.querySelector('.waitlist-existing-step .waitlist-leaderboard-btn')).toBeNull();
        expect(form.querySelector('.waitlist-existing-step')!.textContent).not.toMatch(/#\d/);
    });

    // Downstream sites style and hide these, so they must not change name.
    it('keeps the panel class names sites style', async () => {
        page(FORM);
        await flush();
        const form = await signUp();
        for (const name of ['.waitlist-verify-step', '.waitlist-otp-input', '.waitlist-verify-btn', '.waitlist-resend-btn', '.waitlist-back-btn', '.waitlist-inline-message']) {
            expect(form.querySelector(name), name).toBeTruthy();
        }
        (form.querySelector('.waitlist-otp-input') as HTMLInputElement).value = '123456';
        (form.querySelector('.waitlist-verify-btn') as HTMLButtonElement).click();
        await flush();
        for (const name of ['.waitlist-success-step', '.waitlist-success-icon', '.waitlist-success-title', '.waitlist-success-text']) {
            expect(form.querySelector(name), name).toBeTruthy();
        }
    });

    it('uses the form\'s own wording from its attributes, over the strings and the English', async () => {
        docs['Settings/email_status'] = { isEnabled: false };
        const strings = { signup_on_list: 'Strings title', signup_success_text: 'Strings text' };
        const attr = ` data-strings="${JSON.stringify(strings).replace(/"/g, '&quot;')}"`;
        // Single braces survive a content template's {{ }} filling; double ones work where they survive.
        const worded = '<form data-waitlist-form data-waitlist-id="launch" data-waitlist-success-title="See you there, {name}"'
            + ' data-waitlist-success-text="The joining link goes to {{ email }}." data-waitlist-existing-title="Already registered"'
            + ' data-waitlist-existing-text="Check {email} for the link, {unknown}."><input name="email"><button type="submit">Join</button></form>';
        page(worded, '', '', attr);
        await flush();
        let form = await signUp();
        expect(form.querySelector('.waitlist-success-title')!.textContent).toBe('See you there, Asha');
        expect(form.querySelector('.waitlist-success-text')!.textContent).toBe('The joining link goes to asha@example.com.');

        // Without the attributes, the strings file wins over the English.
        page(FORM, '', '', attr);
        await flush();
        form = await signUp();
        expect(form.querySelector('.waitlist-success-title')!.textContent).toBe('Strings title');
        expect(form.querySelector('.waitlist-success-text')!.textContent).toBe('Strings text');

        callables['finalizeFormSignup'] = () => ({ totalSignups: 0, emailVerified: true, alreadyConfirmed: true });
        page(worded);
        await flush();
        form = await signUp();
        expect(form.querySelector('.waitlist-existing-step .waitlist-success-title')!.textContent).toBe('Already registered');
        expect(form.querySelector('.waitlist-existing-step .waitlist-success-text')!.textContent).toBe('Check asha@example.com for the link, {unknown}.');
    });

    it('sends the visit\'s metadata with the signup, as the app does', async () => {
        page(FORM, '?utm_source=news&plan=pro');
        await flush();
        document.querySelector('form')!.dispatchEvent(new Event('focusin'));
        await signUp();
        const metadata = calls[0].data['signupMetadata'] as Record<string, unknown>;
        expect(metadata).toMatchObject({ utmSource: 'news', queryParams: { plan: 'pro' }, visitCount: 1, formStartCount: 1, isDisposableEmail: false });
        expect(metadata['deviceType']).toBeTruthy();
        expect(JSON.parse(localStorage.getItem('arc_session_data')!).visitCount).toBe(1);
    });

    it('welcomes back someone already on the list', async () => {
        docs['Settings/email_status'] = { isEnabled: false };
        callables['finalizeFormSignup'] = () => ({ totalSignups: 0, emailVerified: true, alreadyConfirmed: true });
        page(FORM);
        await flush();
        const form = await signUp();
        expect(form.querySelector('.waitlist-existing-step .waitlist-success-title')!.textContent).toBe('Welcome back, Asha!');
        expect(form.querySelector('.waitlist-existing-step .waitlist-success-text')!.textContent).toBe('You\'re already on the list.');
    });

    // B2: a translated page's panels are in its language; a missing key stays English.
    it('shows the panels in the page\'s language from the strings publishing put on the script', async () => {
        const strings = { signup_check_email: 'अपना ईमेल देखें', signup_welcome_back_name: 'फिर से स्वागत है, {{ name }}!' };
        const attr = ` data-strings="${JSON.stringify(strings).replace(/"/g, '&quot;')}"`;
        page(FORM, '', '', attr);
        await flush();
        let form = await signUp();
        expect(form.querySelector('.waitlist-verify-step')!.textContent).toContain('अपना ईमेल देखें');
        expect(form.querySelector('.waitlist-verify-btn')!.textContent).toBe('Verify your email');

        docs['Settings/email_status'] = { isEnabled: false };
        callables['finalizeFormSignup'] = () => ({ totalSignups: 0, emailVerified: true, alreadyConfirmed: true });
        page(FORM, '', '', attr);
        await flush();
        form = await signUp();
        expect(form.querySelector('.waitlist-existing-step')!.textContent).toContain('फिर से स्वागत है, Asha!');
    });

    it('shows a closed form and does not sign anyone up', async () => {
        docs['Waitlists/launch'] = { isActive: false, disabledMessage: 'We are full.' };
        page(FORM);
        await flush();
        await signUp();
        expect(document.querySelector('.waitlist-disabled-overlay')!.textContent).toContain('We are full.');
        expect(calls).toEqual([]);
    });

    it('asks the server to create the default form when it does not exist yet', async () => {
        docs = { 'Settings/email_status': { isEnabled: true } };
        page('<form data-waitlist-form data-waitlist-id="waitlist-form"><input name="email"><button type="submit">Join</button></form>');
        await flush();
        expect(calls).toEqual([{ name: 'ensureWaitlistExists', data: { waitlistId: 'waitlist-form' } }]);
    });

    // Only an admin may create any other form, and this script never signs in.
    it('asks for nothing when another form does not exist', async () => {
        docs['Waitlists/launch'] = null;
        page(FORM);
        await flush();
        expect(calls).toEqual([]);
    });

    it('stays usable when the server refuses to create the form', async () => {
        docs = { 'Settings/email_status': { isEnabled: false } };
        callables['ensureWaitlistExists'] = () => { throw Object.assign(new Error('Admin access required.'), { status: 'PERMISSION_DENIED' }); };
        page('<form data-waitlist-form data-waitlist-id="default"><input name="email"><button type="submit">Join</button></form>');
        await flush();
        expect(calls.map((c) => c.name)).toEqual(['ensureWaitlistExists']);
        expect(document.querySelector('[data-waitlist-status]')).toBeNull();
        expect(document.querySelector('[name="email"]')).toBeTruthy();
    });

    it('uses an older install\'s default form instead of starting a new, empty one, as the app does', async () => {
        docs = {
            'Waitlists/get-early-access-to-arc-cms': { isActive: true, otpEnabled: false, totalSignups: 2 },
            'Settings/email_status': { isEnabled: false },
        };
        page('<span data-waitlist-count></span><form data-waitlist-form data-waitlist-id="waitlist-form"><input name="email"><button type="submit">Join</button></form>');
        await flush();
        expect(document.querySelector('[data-waitlist-count]')!.textContent).toBe('2');
        await signUp();
        expect(calls.some((c) => c.name === 'ensureWaitlistExists')).toBe(false);
        expect(calls.find((c) => c.name === 'joinForm')!.data['waitlistId']).toBe('get-early-access-to-arc-cms');
    });

    // RF6 6.1: a failure keeps the form and what was typed, with a line saying why.
    it('says joining failed in the page\'s words, not the server\'s, and keeps the form as it was filled in', async () => {
        callables['joinForm'] = () => { throw Object.assign(new Error('This email cannot join.'), { status: 'INTERNAL' }); };
        page(FORM);
        await flush();
        const form = document.querySelector('form') as HTMLFormElement;
        (form.querySelector('[name="firstName"]') as HTMLInputElement).value = 'Asha';
        await signUp('asha@example.com');

        const status = form.querySelector('[data-waitlist-status]')!;
        expect(status.textContent).toBe('Failed to sign up. Please try again.');
        expect(status.getAttribute('role')).toBe('alert');
        expect(form.textContent).not.toContain('This email cannot join.');
        expect((form.querySelector('[name="email"]') as HTMLInputElement).value).toBe('asha@example.com');
        expect((form.querySelector('[name="firstName"]') as HTMLInputElement).value).toBe('Asha');
        // The address has the focus, to fix or send again.
        expect(document.activeElement).toBe(form.querySelector('[name="email"]'));

        // Sent again, it works, and the line goes.
        callables['joinForm'] = () => ({ ticket: 'ticket-1' });
        form.dispatchEvent(new Event('submit', { cancelable: true }));
        await flush();
        expect(form.querySelector('.waitlist-verify-step')).toBeTruthy();
        expect(calls.filter((c) => c.name === 'joinForm')).toHaveLength(2);
    });

    it('asks for the address in a line under the form, without leaving it', async () => {
        page(FORM);
        await flush();
        const form = document.querySelector('form') as HTMLFormElement;
        (form.querySelector('[name="firstName"]') as HTMLInputElement).value = 'Asha';
        await signUp('  ');
        expect(form.querySelector('[data-waitlist-status]')!.textContent).toBe('Email is required');
        expect((form.querySelector('[name="firstName"]') as HTMLInputElement).value).toBe('Asha');
        expect(calls).toEqual([]);
    });

    it('says there is no connection, in the page\'s language, when the server cannot be reached', async () => {
        const strings = { signup_offline: 'कनेक्शन नहीं है' };
        page(FORM, '', '', ` data-strings="${JSON.stringify(strings).replace(/"/g, '&quot;')}"`);
        await flush();
        const offline = vi.mocked(fetch).getMockImplementation()!;
        vi.mocked(fetch).mockImplementation(async (url, init) => {
            if (String(url).includes('joinForm')) throw new TypeError('Failed to fetch');
            return offline(url, init);
        });
        const form = await signUp('asha@example.com');
        expect(form.querySelector('[data-waitlist-status]')!.textContent).toBe('कनेक्शन नहीं है');
        expect((form.querySelector('[name="email"]') as HTMLInputElement).value).toBe('asha@example.com');
    });

    it('brings the filled-in form back on Change email', async () => {
        page(FORM);
        await flush();
        const form = await signUp('asha@example.com');
        (form.querySelector('.waitlist-back-btn') as HTMLButtonElement).click();
        expect((form.querySelector('[name="email"]') as HTMLInputElement).value).toBe('asha@example.com');
        expect(form.querySelector('[data-waitlist-status]')?.textContent ?? '').toBe('');
    });

    // RF6 6.2: the honeypot the contact form has.
    it('adds a hidden honeypot input, sends it apart from the answers, and never stores it as one', async () => {
        page(FORM);
        await flush();
        const trap = document.querySelector('input[name="arc_website"]') as HTMLInputElement;
        expect(trap).not.toBeNull();
        expect(trap.tabIndex).toBe(-1);
        expect(trap.getAttribute('aria-hidden')).toBe('true');
        trap.value = 'http://spam.example';
        await signUp();
        expect(calls[0].data['arc_website']).toBe('http://spam.example');
        expect(calls[0].data['formData']).not.toHaveProperty('arc_website');

        page(FORM);
        await flush();
        await signUp();
        expect(calls[calls.length - 2].data['arc_website']).toBe('');
    });
});

// RF6 6.12: the visit is tracked for the signup only when analytics consent allows it.
describe('signup metadata and consent', () => {
    const tracked = (metadata: Record<string, unknown>) => 'deviceType' in metadata || 'visitCount' in metadata;

    it('tracks a visitor who accepted the site usage banner', async () => {
        localStorage.setItem('arc_site_usage', 'accepted');
        docs['Settings/site-usage'] = { isEnabled: true };
        page(FORM, '?utm_source=news');
        await flush();
        await signUp();
        expect(tracked(calls[0].data['signupMetadata'] as Record<string, unknown>)).toBe(true);
        expect(localStorage.getItem('arc_session_data')).not.toBeNull();
    });

    it('tracks nothing for a visitor who rejected it: only the campaign and the throwaway flag go', async () => {
        localStorage.setItem('arc_site_usage', 'rejected');
        page(FORM, '?utm_source=news');
        await flush();
        document.querySelector('form')!.dispatchEvent(new Event('focusin'));
        window.dispatchEvent(new Event('click'));
        await signUp('asha@mailinator.com');
        expect(calls[0].data['signupMetadata']).toEqual({ utmSource: 'news', isDisposableEmail: true });
        expect(localStorage.getItem('arc_session_data')).toBeNull();
    });

    it('waits for an answer when the site shows the banner, and tracks without one when it does not', async () => {
        docs['Settings/site-usage'] = { isEnabled: true };
        page(FORM);
        await flush();
        await signUp();
        expect(tracked(calls[0].data['signupMetadata'] as Record<string, unknown>)).toBe(false);
        expect(localStorage.getItem('arc_session_data')).toBeNull();

        docs['Settings/site-usage'] = { isEnabled: false };
        page(FORM);
        await flush();
        await signUp();
        expect(tracked(calls[calls.length - 2].data['signupMetadata'] as Record<string, unknown>)).toBe(true);
    });
});

// SS5 (specs/site-sections-spec.md): contact forms on any published page.
describe('contact forms', () => {
    const CONTACT = '<form data-arc-contact-form><input name="name"><input name="email"><textarea name="message"></textarea>'
        + '<p data-contact-notice>We use your details only to reply.</p><button type="submit">Send</button></form>';

    function fill(values: Record<string, string>): HTMLFormElement {
        const form = document.querySelector('form') as HTMLFormElement;
        for (const [name, value] of Object.entries(values)) {
            (form.querySelector(`[name="${name}"]`) as HTMLInputElement).value = value;
        }
        return form;
    }

    async function send(form: HTMLFormElement): Promise<void> {
        form.dispatchEvent(new Event('submit', { cancelable: true }));
        await flush();
    }

    it('sends the known fields with the page, the language, the time on the page and the honeypot, then thanks the sender', async () => {
        document.documentElement.lang = 'en';
        page(CONTACT);
        const form = fill({ name: ' Asha ', email: 'asha@example.com', message: 'Do you deliver to Pune?' });
        await send(form);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('submitContactMessage');
        expect(calls[0].data).toMatchObject({ name: 'Asha', email: 'asha@example.com', message: 'Do you deliver to Pune?', page: '/', lang: 'en', website: '' });
        expect(typeof calls[0].data['elapsedMs']).toBe('number');
        expect(form.querySelector('.arc-contact-sent')!.textContent).toContain('Thank you');
    });

    it('adds a hidden honeypot input people never fill', () => {
        page(CONTACT);
        const trap = document.querySelector('input[name="website"]') as HTMLInputElement;
        expect(trap).not.toBeNull();
        expect(trap.tabIndex).toBe(-1);
        expect(trap.getAttribute('aria-hidden')).toBe('true');
    });

    it('asks for a valid email and a message before sending anything', async () => {
        page(CONTACT);
        let form = fill({ email: 'not an email', message: 'Hi' });
        await send(form);
        expect(calls).toHaveLength(0);
        expect(form.querySelector('[data-contact-status]')!.textContent).toBe('Please enter a valid email address.');

        form = fill({ email: 'asha@example.com', message: '   ' });
        await send(form);
        expect(calls).toHaveLength(0);
        expect(form.querySelector('[data-contact-status]')!.textContent).toBe('Please write a message.');
    });

    it('says when the sender has sent too many, and keeps the form to try later', async () => {
        callables['submitContactMessage'] = () => { throw Object.assign(new Error('Too many'), { status: 'RESOURCE_EXHAUSTED' }); };
        page(CONTACT);
        const form = fill({ email: 'asha@example.com', message: 'Hello' });
        await send(form);
        expect(form.querySelector('[data-contact-status]')!.textContent).toContain('try again in an hour');
        expect((form.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
        expect((form.querySelector('button') as HTMLButtonElement).textContent).toBe('Send');
    });

    it('speaks the page\'s language from the strings publishing put on the script', async () => {
        page(CONTACT, '', '', ` data-strings="${JSON.stringify({ contact_sent: 'धन्यवाद' }).replace(/"/g, '&quot;')}"`);
        const form = fill({ email: 'asha@example.com', message: 'नमस्ते' });
        await send(form);
        expect(form.textContent).toContain('धन्यवाद');
    });
});

describe('counts', () => {
    it('fills each count with the form\'s confirmed sign-ups', async () => {
        page('<span class="arc-skeleton" data-waitlist-count="launch"></span>');
        await flush();
        const el = document.querySelector('[data-waitlist-count]')!;
        expect(el.textContent).toBe('42');
        expect(el.classList.contains('arc-skeleton')).toBe(false);
    });
});

describe('signed-in hint', () => {
    it('shows the signed-in version to someone signed in to the app on this browser', () => {
        localStorage.setItem('arc:signed-in', '1');
        page('<a data-arc-signed-in hidden>Open the app</a><a data-arc-signed-out>Sign up</a>');
        expect((document.querySelector('[data-arc-signed-in]') as HTMLElement).hidden).toBe(false);
        expect((document.querySelector('[data-arc-signed-out]') as HTMLElement).hidden).toBe(true);
        expect((window as unknown as { arcSite: { signedIn: boolean } }).arcSite.signedIn).toBe(true);
    });

    it('shows the signed-out version to everyone else', () => {
        page('<a data-arc-signed-in hidden>Open the app</a><a data-arc-signed-out>Sign up</a>');
        expect((document.querySelector('[data-arc-signed-in]') as HTMLElement).hidden).toBe(true);
        expect((document.querySelector('[data-arc-signed-out]') as HTMLElement).hidden).toBe(false);
    });

    it('keeps the documented key a page\'s own script reads: arc:signed-in, "1" while signed in (docs/website/home-page.html)', async () => {
        const { SIGNED_IN_KEY, rememberSignedIn } = await import('../../src/app/core/site/signed-in-hint');
        expect(SIGNED_IN_KEY).toBe('arc:signed-in');
        expect(SOURCE).toContain("var SIGNED_IN_KEY = 'arc:signed-in';");
        rememberSignedIn(true);
        expect(localStorage.getItem('arc:signed-in')).toBe('1');
        rememberSignedIn(false);
        expect(localStorage.getItem('arc:signed-in')).toBeNull();
        const docs = readFileSync(join(__dirname, '../../docs/website/home-page.html'), 'utf8');
        expect(docs).toContain("localStorage.getItem('arc:signed-in') === '1'");
    });
});

describe('admin strip (VE-D12, VE-D13)', () => {
    const entry = (value: string) => `<meta name="arc-entry" content="${value}">`;
    const strip = () => document.getElementById('arc-editor-strip');
    const links = () => Array.from(strip()?.shadowRoot?.querySelectorAll<HTMLAnchorElement>('a') ?? [])
        .map((a) => [a.getAttribute('data-arc-strip'), a.getAttribute('href'), a.textContent]);

    type Site = { arcSite?: { stripClosed?: boolean; drawEditorStrip: () => void } };
    const freshLoad = () => { delete (window as unknown as Site).arcSite; };

    beforeEach(() => {
        sessionStorage.clear();
        localStorage.setItem('arc_editor_strip', '1');
        freshLoad();
    });

    it('draws nothing for a visitor', () => {
        localStorage.removeItem('arc_editor_strip');
        page('<p>Page</p>', '', entry('articles/doc1'));
        expect(strip()).toBeNull();
    });

    it('offers Edit this page and Back to admin on a content page, in a shadow root', () => {
        page('<p>Page</p>', '', entry('articles/doc1'));
        expect(strip()!.shadowRoot).not.toBeNull();
        expect(links()).toEqual([
            ['admin', '/admin/contents/articles', 'Back to admin'],
            ['edit', '/admin/edit/articles/doc1', 'Edit this page'],
        ]);
        // The site's CSS cannot reach it: nothing of it is in the page's own tree.
        expect(document.querySelector('[data-arc-strip]')).toBeNull();
    });

    it('comes first in the page, as on the screen, so Tab reaches it before the page (review L)', () => {
        page('<a href="/a">First link</a><p>Page</p>', '', entry('articles/doc1'));
        expect(document.body.firstElementChild).toBe(strip());
    });

    it('offers Edit this page and Add new on a list page, and goes back to the type\'s entries (VE-D65)', () => {
        page('<p>List</p>', '', entry('articles'));
        expect(links()).toEqual([
            ['admin', '/admin/contents/articles', 'Back to admin'],
            ['edit', '/admin/edit-page/list/articles', 'Edit this page'],
            ['add', '/admin/edit/articles/new', 'Add new'],
        ]);
    });

    it('offers Edit home page on the home page, and Back to admin goes to More Pages (VE-D56)', () => {
        page('<p>Page</p>', '', entry('home'));
        expect(links()).toEqual([
            ['admin', '/admin/more-pages', 'Back to admin'],
            ['edit', '/admin/edit-page/home', 'Edit home page'],
        ]);
    });

    it('offers Edit this page on a static page only when it marks areas editors change (VE-D56)', () => {
        page('<p>Page</p>', '', '<meta name="arc-entry" content="p/about-us" data-arc-editable="">');
        expect(links()).toEqual([
            ['admin', '/admin/more-pages', 'Back to admin'],
            ['edit', '/admin/edit-page/p/about-us', 'Edit this page'],
        ]);
        strip()?.remove();
        freshLoad();
        page('<p>Page</p>', '', entry('p/privacy-policy'));
        expect(links()).toEqual([['admin', '/admin/more-pages', 'Back to admin']]);
    });

    it('follows the page when it gains its marks, as an app-drawn page sets them (VE-D56)', () => {
        page('<p>Page</p>', '', entry('p/about-us'));
        expect(links()).toEqual([['admin', '/admin/more-pages', 'Back to admin']]);
        document.querySelector('meta[name="arc-entry"]')!.setAttribute('data-arc-editable', '');
        (window as unknown as { arcSite: { drawEditorStrip: () => void } }).arcSite.drawEditorStrip();
        expect(links().map((l) => l[1])).toEqual(['/admin/more-pages', '/admin/edit-page/p/about-us']);
    });

    it('tells a type slugged home or p from the home page and static pages by the address (VE3.11)', () => {
        page('<p>Page</p>', '', entry('articles/doc1'));
        const stripLinks = (window as unknown as { arcSite: { _internal: { stripLinks: (e: string, path: string, editable?: boolean) => { name: string; href: string }[] } } })
            .arcSite._internal.stripLinks;
        const names = (e: string, path: string) => stripLinks(e, path).map((l) => `${l.name} ${l.href}`);
        expect(names('home', '/')).toEqual(['edit /admin/edit-page/home', 'admin /admin/more-pages']);
        expect(names('home', '/hi')).toEqual(['edit /admin/edit-page/home', 'admin /admin/more-pages']);
        expect(names('home', '/home')).toEqual(['edit /admin/edit-page/list/home', 'add /admin/edit/home/new', 'admin /admin/contents/home']);
        expect(names('home', '/hi/home.html')).toEqual(['edit /admin/edit-page/list/home', 'add /admin/edit/home/new', 'admin /admin/contents/home']);
        expect(names('p/privacy-policy', '/p/privacy-policy')).toEqual(['admin /admin/more-pages']);
        expect(names('p/privacy-policy', '/p/privacy-policy.html')).toEqual(['admin /admin/more-pages']);
        expect(stripLinks('p/about-us', '/p/about-us', true).map((l) => l.href)).toEqual(['/admin/edit-page/p/about-us', '/admin/more-pages']);
        expect(names('p/doc1', '/p/my-first-entry')).toEqual(['edit /admin/edit/p/doc1', 'admin /admin/contents/p']);
        expect(names('p', '/p')).toEqual(['edit /admin/edit-page/list/p', 'add /admin/edit/p/new', 'admin /admin/contents/p']);
    });

    it('says its links in the strings the app hands it, over the script tag\'s (VE3.11)', () => {
        const hindi = ` data-parts="strip" data-strings="${JSON.stringify({ strip_edit: 'संपादित करें' }).replace(/"/g, '&quot;')}"`;
        page('<p>Page</p>', '', entry('articles/doc1'), hindi);
        expect(links().find((l) => l[0] === 'edit')![2]).toBe('संपादित करें');
        const site = (window as unknown as { arcSite: { drawEditorStrip: (s?: Record<string, string>) => void } }).arcSite;
        site.drawEditorStrip({ strip_edit: 'Modifier', strip_admin: 'Admin' });
        expect(links()).toEqual([['admin', '/admin/contents/articles', 'Admin'], ['edit', '/admin/edit/articles/doc1', 'Modifier']]);
        // The page went back to a language with no strings: English, not the tag's Hindi.
        site.drawEditorStrip({});
        expect(links().find((l) => l[0] === 'edit')![2]).toBe('Edit this page');
    });

    it('draws nothing on a page that does not name what it is', () => {
        page('<p>Page</p>', '', '');
        expect(strip()).toBeNull();
        expect(document.getElementById('arc-editor-strip-push')).toBeNull();
    });

    it('sits across the top and pushes the page down by its height', () => {
        page('<p>Page</p>', '', entry('articles/doc1'));
        expect(strip()!.shadowRoot!.querySelector('style')!.textContent).toMatch(/:host\{[^}]*position:fixed;[^}]*top:0;left:0;right:0;height:40px;/);
        const push = document.getElementById('arc-editor-strip-push')!;
        expect(push.textContent).toContain('html{margin-top:40px !important;');
        expect(push.textContent).toContain('--arc-strip-height:40px;');
        // Nothing pushed on paper.
        expect(push.textContent).toContain('@media print{html{margin-top:0 !important;}}');
    });

    it('moves a header pinned to the top below it, and puts it back when closed', () => {
        page('<header id="fixed" style="position:fixed;top:0">Site</header>'
            + '<nav id="sticky" style="position:sticky;top:0px">Menu</nav>'
            + '<div id="low" style="position:fixed;top:120px">Toast</div>'
            + '<div id="foot" style="position:fixed;bottom:0">Cookie</div>', '', entry('articles/doc1'));
        const top = (id: string) => (document.getElementById(id) as HTMLElement).style.getPropertyValue('top');
        expect(top('fixed')).toBe('40px');
        expect(top('sticky')).toBe('40px');
        expect(top('low')).toBe('120px');
        expect(top('foot')).toBe('');
        (strip()!.shadowRoot!.querySelector('[data-arc-strip="close"]') as HTMLButtonElement).click();
        expect(top('fixed')).toBe('0px');
        expect(top('sticky')).toBe('0px');
        expect(document.getElementById('fixed')!.hasAttribute('data-arc-strip-top')).toBe(false);
        expect(document.getElementById('arc-editor-strip-push')).toBeNull();
    });

    it('puts back a header that stops being pinned, as the page scrolls (review M9)', () => {
        vi.useFakeTimers();
        try {
            page('<header id="bar" style="position:fixed;top:0">Site</header>', '', entry('articles/doc1'));
            const bar = document.getElementById('bar') as HTMLElement;
            expect(bar.style.getPropertyValue('top')).toBe('40px');
            // The site's own script unpins it at the top of the page.
            bar.style.setProperty('position', 'absolute');
            window.dispatchEvent(new Event('scroll'));
            vi.advanceTimersByTime(200);
            expect(bar.style.getPropertyValue('top')).toBe('0px');
            expect(bar.hasAttribute('data-arc-strip-top')).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('moves only what is under the strip, and never a box as tall as the window (review M9)', () => {
        const doc = document as Document & { elementsFromPoint?: unknown };
        doc.elementsFromPoint = () => ['head', 'menu'].map((id) => document.getElementById(id)).filter(Boolean);
        const real = HTMLElement.prototype.getBoundingClientRect;
        HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
            return this.id === 'menu' ? ({ height: window.innerHeight } as DOMRect) : real.call(this);
        };
        try {
            page('<header id="head" style="position:fixed;top:0">Site</header>'
                + '<div id="menu" style="position:fixed;top:0">Open menu</div>'
                + '<div style="overflow:auto"><table><thead id="thead" style="position:sticky;top:0"></thead></table></div>', '', entry('articles/doc1'));
            const top = (id: string) => (document.getElementById(id) as HTMLElement).style.getPropertyValue('top');
            expect(top('head')).toBe('40px');
            // A sticky table head inside its own scroll box is not under the strip.
            expect(top('thead')).toBe('0px');
            // An open menu as tall as the window would run off its bottom.
            expect(top('menu')).toBe('0px');
        } finally {
            HTMLElement.prototype.getBoundingClientRect = real;
            delete doc.elementsFromPoint;
        }
    });

    it('stops moving headers once another copy of the script took the strip away', async () => {
        vi.useFakeTimers();
        try {
            page('<p>Page</p>', '', entry('articles/doc1'), ' data-parts="strip"');
            // A second copy, as the app adds for a page with a form: it now answers drawEditorStrip.
            new Function(SOURCE)();
            document.head.innerHTML = '';
            (window as unknown as { arcSite: { drawEditorStrip: () => void } }).arcSite.drawEditorStrip();
            expect(strip()).toBeNull();
            window.dispatchEvent(new Event('scroll'));
            vi.advanceTimersByTime(200);
            // An admin screen's pinned header appears: nothing moves it.
            document.body.insertAdjacentHTML('beforeend', '<header id="admin" style="position:fixed;top:0">Admin</header>');
            window.dispatchEvent(new Event('scroll'));
            vi.advanceTimersByTime(200);
            expect((document.getElementById('admin') as HTMLElement).style.getPropertyValue('top')).toBe('0px');
        } finally {
            vi.useRealTimers();
        }
    });

    it('puts Back to admin on the left and the page\'s own action on the right', () => {
        page('<p>Page</p>', '', entry('articles/doc1'));
        const order = Array.from(strip()!.shadowRoot!.querySelector('.bar')!.children).map((el) => el.className);
        expect(order).toEqual(['admin', 'space', 'edit', 'close']);
    });

    it('runs only the strip for the app\'s own pages, and follows the page or leaves with it', async () => {
        page(FORM, '', entry('articles/doc1'), ' data-parts="strip"');
        expect(links()[1]).toEqual(['edit', '/admin/edit/articles/doc1', 'Edit this page']);
        await signUp();
        // The app runs its own forms: this copy left them alone.
        expect(calls).toEqual([]);
        const site = (window as unknown as { arcSite: { drawEditorStrip: () => void } }).arcSite;
        document.head.innerHTML = entry('articles');
        site.drawEditorStrip();
        expect(links()[2]).toEqual(['add', '/admin/edit/articles/new', 'Add new']);
        document.head.innerHTML = '';
        site.drawEditorStrip();
        expect(strip()).toBeNull();
        expect(document.querySelector('[data-arc-strip-top]')).toBeNull();
    });

    it('escapes what the page names into the addresses', () => {
        page('<p>Page</p>', '', entry('a b/x?y'));
        expect(links()[1]).toEqual(['edit', '/admin/edit/a%20b/x%3Fy', 'Edit this page']);
    });

    it('hides with its close button until the page is loaded again', () => {
        sessionStorage.setItem('arc_editor_strip_hidden', '1'); // the old tab-wide close
        page('<p>Page</p>', '', entry('articles/doc1'));
        // The old tab-wide close is forgotten: the strip is back.
        expect(strip()).not.toBeNull();
        expect(sessionStorage.getItem('arc_editor_strip_hidden')).toBeNull();
        (strip()!.shadowRoot!.querySelector('[data-arc-strip="close"]') as HTMLButtonElement).click();
        expect(strip()).toBeNull();
        // The app moves to another page, or runs a second copy of the script: still closed.
        document.head.innerHTML = entry('articles/doc2');
        (window as unknown as Site).arcSite!.drawEditorStrip();
        new Function(SOURCE)();
        expect(strip()).toBeNull();
        // A new page load (a link on a published page, or a refresh): back.
        freshLoad();
        page('<p>Next</p>', '', entry('articles/doc2'));
        expect(strip()).not.toBeNull();
    });

    it('keeps its links when pointed at on the same page, and follows a page the app moved to', () => {
        page('<p>Page</p>', '', entry('articles/doc1'));
        const host = strip()!;
        const first = host.shadowRoot!.querySelector('a.edit');
        host.dispatchEvent(new Event('pointerenter'));
        // The same link element: a press and its release land on one element, so the click counts.
        expect(host.shadowRoot!.querySelector('a.edit')).toBe(first);
        document.head.innerHTML = entry('articles/doc2');
        host.dispatchEvent(new Event('pointerenter'));
        expect(links()[1]).toEqual(['edit', '/admin/edit/articles/doc2', 'Edit this page']);
    });

    it('is hidden when printing', () => {
        page('<p>Page</p>', '', entry('articles/doc1'));
        expect(strip()!.shadowRoot!.querySelector('style')!.textContent).toMatch(/@media print\{:host\{display:none !important;\}\}/);
    });

    it('is never drawn on the admin\'s own screens', () => {
        page('<p>Preview</p>', '', entry('articles/doc1'));
        strip()?.remove();
        history.replaceState({}, '', '/admin/preview/articles/doc1');
        document.body.innerHTML = '<p>Preview</p>';
        new Function(SOURCE)();
        expect(strip()).toBeNull();
    });

    it('keeps the key the admin app writes', async () => {
        const { EDITOR_STRIP_KEY, rememberEditorStrip } = await import('../../src/app/core/site/signed-in-hint');
        expect(EDITOR_STRIP_KEY).toBe('arc_editor_strip');
        expect(SOURCE).toContain("var EDITOR_STRIP_KEY = 'arc_editor_strip';");
        rememberEditorStrip(false);
        expect(localStorage.getItem('arc_editor_strip')).toBeNull();
        rememberEditorStrip(true);
        expect(localStorage.getItem('arc_editor_strip')).toBe('1');
    });
});

describe('setup', () => {
    type Site = { arcSite: { _internal: { redirect: (url: string) => void } } };
    function openSetup(state: string, search = ''): ReturnType<typeof vi.fn> {
        page('<h1>Home</h1>', search, '', ` data-setup="${state}"`);
        const redirect = vi.fn();
        (window as unknown as Site).arcSite._internal.redirect = redirect;
        return redirect;
    }

    it('sends a fresh install to the setup wizard', async () => {
        const redirect = openSetup('first-run');
        await flush();
        expect(redirect).toHaveBeenCalledWith('/onboarding');
    });

    it('stays once the wizard is finished, and with ?debug', async () => {
        docs['Settings/onboarding_status'] = { completed: true };
        const done = openSetup('first-run');
        await flush();
        expect(done).not.toHaveBeenCalled();
        delete docs['Settings/onboarding_status'];
        const debug = openSetup('first-run', '?debug');
        await flush();
        expect(debug).not.toHaveBeenCalled();
    });

    it('sends back to an unfinished wizard only someone signed in', async () => {
        docs['Settings/onboarding_status'] = { completed: false, startedBy: 'u1' };
        const visitor = openSetup('in-progress');
        await flush();
        expect(visitor).not.toHaveBeenCalled();
        localStorage.setItem('arc:signed-in', '1');
        const owner = openSetup('in-progress');
        await flush();
        expect(owner).toHaveBeenCalledWith('/onboarding');
    });

    it('checks nothing on a page published after setup', async () => {
        page('<h1>Home</h1>');
        await flush();
        expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('onboarding_status'))).toBe(false);
    });
});

describe('installable app', () => {
    // First: every run of the script adds its listener to the one test window.
    it('does nothing on a page without a manifest', () => {
        page('<button data-arc-install hidden>Install</button>');
        window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true }));
        expect((document.querySelector('[data-arc-install]') as HTMLButtonElement).hidden).toBe(true);
    });

    it('shows the install button once the browser offers installing, and asks on click', async () => {
        page('<button data-arc-install hidden>Install</button>', '', '<link rel="manifest" href="/manifest.webmanifest">');
        const prompt = vi.fn();
        const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
            prompt, userChoice: Promise.resolve({ outcome: 'accepted' }),
        });
        window.dispatchEvent(event);
        const button = document.querySelector('[data-arc-install]') as HTMLButtonElement;
        expect(button.hidden).toBe(false);
        expect((window as unknown as { arcSite: { canInstall: boolean } }).arcSite.canInstall).toBe(true);
        button.click();
        expect(prompt).toHaveBeenCalled();
    });
});
