/**
 * arc-site.js, the live parts of a published page (public/assets/js/arc-site.js,
 * specs/own-website-spec.md W5): signup forms through the same callables as the
 * app, counts, referral codes, the install button and the signed-in hint.
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
                return { ok: false, status: 400, json: async () => ({ error: { message: (error as Error).message, status: 'INVALID_ARGUMENT' } }) };
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
        joinForm: () => ({ memberId: 'm1', referralCode: 'ASHA1234', referralLink: 'https://site/?ref=ASHA1234', waitlistedUserId: 'w1' }),
        requestFormOtp: () => ({ sent: true, status: 'sent' }),
        verifyFormOtp: (d) => { if (d['code'] !== '123456') throw new Error('Wrong code'); return { verified: true }; },
        finalizeFormSignup: () => ({ queuePosition: 7, totalSignups: 42, emailVerified: true }),
        creditReferral: () => ({ recorded: true }),
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
    it('joins, asks for the emailed code, then shows the position and referral link', async () => {
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
        expect(calls[2].data).toEqual({ waitlistId: 'launch', email: 'asha@example.com', code: '123456' });
        expect(calls[3].data).toMatchObject({ waitlistId: 'launch', userId: 'm1' });
        expect(form.querySelector('.waitlist-success-step')!.textContent).toContain('#7');
        expect(form.querySelector('.waitlist-success-step')!.textContent).toContain('42');
        expect((form.querySelector('.waitlist-copy-input') as HTMLInputElement).value).toBe('ASHA1234');
        expect(form.querySelector('a.waitlist-leaderboard-btn')!.getAttribute('href')).toBe('/leaderboard/launch/w1');
    });

    it('shows the server\'s message for a wrong code and lets the person try again', async () => {
        page(FORM);
        await flush();
        const form = await signUp();
        (form.querySelector('.waitlist-otp-input') as HTMLInputElement).value = '000000';
        (form.querySelector('.waitlist-verify-btn') as HTMLButtonElement).click();
        await flush();
        expect(form.querySelector('.waitlist-inline-message')!.textContent).toBe('Wrong code');
        expect(form.querySelector('.waitlist-otp-input')).toBeTruthy();
    });

    it('confirms at once when email is off, as the app does', async () => {
        docs['Settings/email_status'] = { isEnabled: false };
        page(FORM);
        await flush();
        const form = await signUp();
        expect(calls.map((c) => c.name)).toEqual(['joinForm', 'requestFormOtp', 'finalizeFormSignup']);
        expect(form.querySelector('.waitlist-success-step')).toBeTruthy();
    });

    it('credits the referral a visitor arrived with, then forgets it', async () => {
        docs['Settings/email_status'] = { isEnabled: false };
        page(FORM, '?ref=FRIEND99');
        await flush();
        await signUp();
        expect(calls.find((c) => c.name === 'finalizeFormSignup')!.data['referredBy']).toBe('FRIEND99');
        expect(calls.find((c) => c.name === 'creditReferral')!.data).toMatchObject({ referrerCode: 'FRIEND99', referredMemberId: 'm1', status: 'completed' });
        expect(localStorage.getItem('arc_referral')).toBeNull();
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

    it('welcomes back someone already on the list, and credits no referral for them', async () => {
        docs['Settings/email_status'] = { isEnabled: false };
        callables['finalizeFormSignup'] = () => ({ queuePosition: 3, totalSignups: 0, emailVerified: true, alreadyConfirmed: true });
        page(FORM, '?ref=FRIEND99');
        await flush();
        const form = await signUp();
        expect(form.querySelector('.waitlist-existing-step')!.textContent).toContain('Welcome back, Asha!');
        expect(form.querySelector('.waitlist-existing-step')!.textContent).toContain('#3');
        expect(calls.some((c) => c.name === 'creditReferral')).toBe(false);
    });

    it('shows a closed form and does not sign anyone up', async () => {
        docs['Waitlists/launch'] = { isActive: false, disabledMessage: 'We are full.' };
        page(FORM);
        await flush();
        await signUp();
        expect(document.querySelector('.waitlist-disabled-overlay')!.textContent).toContain('We are full.');
        expect(calls).toEqual([]);
    });

    it('asks the server to create a form that does not exist yet', async () => {
        docs['Waitlists/launch'] = null;
        page(FORM);
        await flush();
        expect(calls).toEqual([{ name: 'ensureWaitlistExists', data: { waitlistId: 'launch' } }]);
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

    it('shows the server\'s error when joining fails', async () => {
        callables['joinForm'] = () => { throw new Error('This email cannot join.'); };
        page(FORM);
        await flush();
        const form = await signUp();
        expect(form.querySelector('.waitlist-error-text')!.textContent).toBe('This email cannot join.');
        (form.querySelector('.waitlist-retry-btn') as HTMLButtonElement).click();
        expect(form.querySelector('[name="email"]')).toBeTruthy();
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
