/**
 * Arc CMS on published pages: the live parts of a static page, with no Angular
 * and no Firebase SDK (specs/own-website-spec.md, W5).
 *
 * The publish pipeline adds this script to the home page with its settings as
 * data attributes: data-functions (the Cloud Functions base URL), data-group
 * (the functions' name prefix, "arccms"), data-project and data-database (for
 * public Firestore reads). It provides:
 *
 * - Signup forms, <form data-waitlist-form data-waitlist-id="…">: the same steps
 *   and the same callables as the app's own signup (src/app/pages/waitlist/
 *   waitlist.service.ts): join, the emailed code when the form asks for one, then
 *   a short confirmation. The form's data-waitlist-success-title,
 *   data-waitlist-success-text, data-waitlist-existing-title and
 *   data-waitlist-existing-text attributes reword it for that form. The terms
 *   notice is added by the publish pipeline, and by the app's preview of the home
 *   page (src/app/pages/index.page.ts), which runs this same script.
 *   A failed step puts the form back as it was filled in, with a line saying why in
 *   the page's language (the server's own English is never shown). A hidden
 *   honeypot input (arc_website) goes with each signup for joinForm's spam check.
 * - Contact forms, <form data-arc-contact-form> with inputs named name, email,
 *   phone, subject and message (email and message required): sent to
 *   submitContactMessage, then replaced by a thank-you. A hidden honeypot input
 *   and the time since the page loaded go with it, for the server's spam checks
 *   (specs/site-sections-spec.md, SS5). The privacy line is added by publishing.
 * - Live counts, <span data-waitlist-count="form-id">: confirmed sign-ups.
 * - Signup metadata: the same fields and visitor history as the app's forms
 *   (device, UTM, visits, scroll depth, time on page), and "Welcome back" for
 *   someone already on the list. Only when analytics consent allows it: the visitor
 *   accepted the site usage banner, or gave no answer on a site that shows none.
 *   Otherwise only the UTM fields and the throwaway-address flag are sent.
 * - The installable app, when the page links a manifest: registers the service
 *   worker; <button data-arc-install hidden> appears once the browser offers
 *   installing, and window.arcSite.install() asks.
 * - A signed-in hint: elements with data-arc-signed-in show for people signed in
 *   to the app on this browser, data-arc-signed-out for everyone else.
 * - Setup: a page published before the setup wizard was finished (data-setup)
 *   sends the owner to /onboarding, as the app's home page does. ?debug skips it.
 *
 * Callables are called over plain fetch with the callable protocol ({ data } in,
 * { result } or { error } out), like arc-search.js.
 */
(function () {
    'use strict';

    var script = document.currentScript || document.querySelector('script[src*="/assets/js/arc-site.js"]');
    var config = {
        functions: (script && script.getAttribute('data-functions')) || '',
        group: (script && script.getAttribute('data-group')) || 'arccms',
        project: (script && script.getAttribute('data-project')) || '',
        database: (script && script.getAttribute('data-database')) || '(default)',
        setup: (script && script.getAttribute('data-setup')) || '',
    };

    /**
     * The signup panels' text in the page's language: the `signup_*` keys of
     * strings/{lang}.json, put on the script tag by publishing (the default
     * language's file too, when the site has one). English when a key is missing.
     */
    var STRINGS = (function () {
        try { return JSON.parse((script && script.getAttribute('data-strings')) || '{}') || {}; } catch (e) { return {}; }
    })();

    /** A signup panel string, with {{ name }} placeholders filled from params. */
    function t(key, english, params) {
        var text = typeof STRINGS[key] === 'string' && STRINGS[key] ? STRINGS[key] : english;
        return text.replace(/\{\{\s*(\w+)\s*\}\}/g, function (match, name) {
            return params && params[name] !== undefined ? String(params[name]) : match;
        });
    }

    /**
     * A form step's refusal in the page's language, from its code and reason, never
     * the server's English. `fallback` is the step's own failure line; `step` is
     * 'verify' while a code is being checked.
     */
    function formError(error, fallback, step) {
        var code = error && error.code;
        var reason = error && error.reason;
        if (code === 'NETWORK') return t('signup_offline', 'No internet connection. Check it and try again.');
        if (reason === 'form-closed' || reason === 'form-missing') return t('signup_form_closed', 'This form is not taking signups right now.');
        if (code === 'PERMISSION_DENIED') return t('signup_expired', 'This signup has expired. Please fill in the form again.');
        if (code === 'RESOURCE_EXHAUSTED') {
            if (reason === 'wait') return t('signup_wait', 'Please wait a minute before asking for another code.');
            if (reason === 'too-many-codes') return t('signup_too_many_codes', 'Too many codes for this address. Please try again later.');
            if (reason === 'code-locked') return t('signup_code_locked', 'Too many tries. Please ask for a new code.');
            return t('signup_too_many', 'Too many attempts. Please try again later.');
        }
        if (step === 'verify' && (code === 'INVALID_ARGUMENT' || code === 'DEADLINE_EXCEEDED' || code === 'NOT_FOUND')) {
            return t('signup_code_invalid', 'Invalid or expired code');
        }
        if (step === 'join' && code === 'INVALID_ARGUMENT') return t('signup_check_answers', 'Please check your answers and try again.');
        return fallback;
    }

    /** Where referral codes were kept before signup forms dropped referrals; cleared on load. */
    var OLD_REFERRAL_KEY = 'arc_referral';
    var SIGNED_IN_KEY = 'arc:signed-in';
    var DEFAULT_FORM = 'waitlist-form';
    /** Where installs from before the default form id kept their default form (src/shared/constants/waitlist-form.ts). */
    var LEGACY_DEFAULT_FORMS = ['get-early-access-to-arc-cms', 'default'];
    var defaultForm = null;

    // ─── Server ────────────────────────────────────────────────────────────

    /**
     * A callable by its plain name. Rejects with the server's status as `code` and
     * its reason as `reason`, or with code NETWORK when the server could not be reached.
     */
    function call(name, data) {
        return fetch(config.functions.replace(/\/+$/, '') + '/' + config.group + '-' + name, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: data }),
        }).catch(function () {
            var offline = new Error('Network error');
            offline.code = 'NETWORK';
            throw offline;
        }).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (body) {
                if (!res.ok || body.error) {
                    var error = new Error((body.error && body.error.message) || 'Request failed');
                    error.code = body.error && body.error.status;
                    error.reason = body.error && body.error.details && body.error.details.reason;
                    throw error;
                }
                return body.result;
            });
        });
    }

    /** A public Firestore document's fields as plain values, or null when it does not exist. */
    function readDoc(path) {
        var url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(config.project)
            + '/databases/' + encodeURIComponent(config.database) + '/documents/' + path;
        return fetch(url).then(function (res) {
            if (res.status === 404) return null;
            if (!res.ok) throw new Error('Could not read ' + path);
            return res.json().then(function (doc) { return plain({ mapValue: { fields: doc.fields || {} } }); });
        });
    }

    function plain(value) {
        if (!value) return null;
        if ('stringValue' in value) return value.stringValue;
        if ('booleanValue' in value) return value.booleanValue;
        if ('integerValue' in value) return Number(value.integerValue);
        if ('doubleValue' in value) return value.doubleValue;
        if ('nullValue' in value) return null;
        if ('timestampValue' in value) return value.timestampValue;
        if ('arrayValue' in value) return (value.arrayValue.values || []).map(plain);
        if ('mapValue' in value) {
            var out = {};
            var fields = value.mapValue.fields || {};
            for (var key in fields) out[key] = plain(fields[key]);
            return out;
        }
        return null;
    }

    // ─── Forms ─────────────────────────────────────────────────────────────

    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function firstNameFrom(email) {
        var name = (email.split('@')[0] || '').split(/[._+-]/)[0] || '';
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    // ─── Signup metadata ───────────────────────────────────────────────────
    // The same fields, names and visitor history (localStorage arc_session_data)
    // as the app's forms (src/app/pages/waitlist/signup-metadata.service.ts), so
    // a signup from a published page records what one from the app does.

    var SESSION_KEY = 'arc_session_data';
    var LEGACY_VISIT_COUNT_KEY = 'arc_visit_count';
    var LEGACY_RETURN_VISITOR_KEY = 'arc_return_visitor';
    var DISPOSABLE_DOMAINS = ['10minutemail.com', 'guerrillamail.com', 'mailinator.com', 'tempmail.com', 'yopmail.com',
        'throwaway.email', 'maildrop.cc', 'fakeinbox.com', 'trashmail.com', 'getnada.com', 'temp-mail.org'];
    var visit = { loadedAt: Date.now(), maxScroll: 0, clicks: 0, tabSwitches: 0, formStarted: false, tracking: false, allowed: false, session: null };

    /** Where the app keeps this visitor's answer to the site usage banner (site-usage.model.ts). */
    var CONSENT_KEY = 'arc_site_usage';

    /**
     * Whether this visitor's visit may be tracked for the signup metadata, as analytics
     * consent allows: yes once they accepted the site usage banner, never once they
     * rejected it, and without an answer only when the site shows no banner
     * (Settings/site-usage). Unknown counts as no.
     */
    function trackingAllowed() {
        var answer = '';
        try { answer = localStorage.getItem(CONSENT_KEY) || ''; } catch (e) { /* storage off */ }
        if (answer === 'accepted') return Promise.resolve(true);
        if (answer === 'rejected' || !config.project) return Promise.resolve(false);
        return readDoc('Settings/site-usage')
            .then(function (settings) { return !(settings && settings.isEnabled === true); })
            .catch(function () { return false; });
    }

    function detectDeviceType(ua) {
        if (/iPad|Android(?!.*Mobile)|tablet/i.test(ua)) return 'tablet';
        if (/Mobile|iPhone|iPod|Android.*Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return 'mobile';
        return 'desktop';
    }

    function detectOS(ua) {
        var m;
        if (/Windows NT 10/i.test(ua)) return 'Windows 10';
        if (/Windows NT 6.3/i.test(ua)) return 'Windows 8.1';
        if (/Windows NT 6.2/i.test(ua)) return 'Windows 8';
        if (/Windows NT 6.1/i.test(ua)) return 'Windows 7';
        if (/Windows/i.test(ua)) return 'Windows';
        if (/Mac OS X/i.test(ua)) return (m = ua.match(/Mac OS X (\d+[._]\d+)/)) ? 'macOS ' + m[1].replace('_', '.') : 'macOS';
        if (/iPhone|iPad|iPod/i.test(ua)) return (m = ua.match(/OS (\d+_\d+)/)) ? 'iOS ' + m[1].replace('_', '.') : 'iOS';
        if (/Android/i.test(ua)) return (m = ua.match(/Android (\d+\.?\d*)/)) ? 'Android ' + m[1] : 'Android';
        if (/Linux/i.test(ua)) return 'Linux';
        if (/CrOS/i.test(ua)) return 'Chrome OS';
        return 'Unknown';
    }

    function detectBrowser(ua) {
        if (/Edg\//i.test(ua)) return 'Edge';
        if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return 'Opera';
        if (/Chrome/i.test(ua) && !/Chromium/i.test(ua)) return 'Chrome';
        if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'Safari';
        if (/Firefox/i.test(ua)) return 'Firefox';
        if (/MSIE|Trident/i.test(ua)) return 'Internet Explorer';
        return 'Unknown';
    }

    function detectBrowserVersion(ua) {
        var m = null;
        if (/Edg\//i.test(ua)) m = ua.match(/Edg\/(\d+)/);
        else if (/OPR\//i.test(ua)) m = ua.match(/OPR\/(\d+)/);
        else if (/Chrome/i.test(ua)) m = ua.match(/Chrome\/(\d+)/);
        else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) m = ua.match(/Version\/(\d+)/);
        else if (/Firefox/i.test(ua)) m = ua.match(/Firefox\/(\d+)/);
        return m ? m[1] : '';
    }

    function loadSession() {
        if (visit.session) return visit.session;
        var fresh = { firstVisitTimestamp: Date.now(), lastVisitTimestamp: Date.now(), visitCount: 0, maxScrollDepthPercent: 0, totalTimeOnPageMs: 0, formStartCount: 0 };
        try {
            var stored = localStorage.getItem(SESSION_KEY);
            if (stored) return (visit.session = JSON.parse(stored));
            var legacyCount = parseInt(localStorage.getItem(LEGACY_VISIT_COUNT_KEY) || '0', 10);
            var legacyReturn = localStorage.getItem(LEGACY_RETURN_VISITOR_KEY) === 'true';
            var migrated = legacyCount > 0 ? legacyCount : legacyReturn ? 1 : 0;
            fresh.visitCount = migrated;
            if (migrated > 0) fresh.firstVisitTimestamp = 0;
            if (legacyCount > 0 || legacyReturn) {
                localStorage.removeItem(LEGACY_VISIT_COUNT_KEY);
                localStorage.removeItem(LEGACY_RETURN_VISITOR_KEY);
            }
        } catch (e) { /* storage off */ }
        return (visit.session = fresh);
    }

    function saveSession() {
        try { if (visit.session) localStorage.setItem(SESSION_KEY, JSON.stringify(visit.session)); } catch (e) { /* storage off */ }
    }

    /** Starts counting visits, scroll depth, clicks and tab switches, as the app's forms do. */
    function startTracking() {
        if (visit.tracking) return;
        visit.tracking = true;
        var data = loadSession();
        data.visitCount += 1;
        data.lastVisitTimestamp = Date.now();
        if (data.firstVisitTimestamp === 0 && data.visitCount === 1) data.firstVisitTimestamp = Date.now();
        visit.maxScroll = data.maxScrollDepthPercent || 0;
        saveSession();
        window.addEventListener('scroll', function () {
            var top = window.scrollY || document.documentElement.scrollTop;
            var height = document.documentElement.scrollHeight - window.innerHeight;
            if (height <= 0) return;
            var percent = Math.min(Math.round((top / height) * 100), 100);
            if (percent > visit.maxScroll) {
                visit.maxScroll = percent;
                if (percent > data.maxScrollDepthPercent) { data.maxScrollDepthPercent = percent; saveSession(); }
            }
        }, { passive: true });
        window.addEventListener('click', function () { visit.clicks++; }, { passive: true });
        document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') visit.tabSwitches++; });
        window.addEventListener('beforeunload', function () {
            data.totalTimeOnPageMs += Date.now() - visit.loadedAt;
            data.maxScrollDepthPercent = visit.maxScroll;
            saveSession();
        });
    }

    /** Counts a person starting to fill a form, once a page view. */
    function trackFormStart() {
        if (visit.formStarted || !visit.allowed) return;
        visit.formStarted = true;
        loadSession().formStartCount += 1;
        saveSession();
    }

    function withoutUndefined(object) {
        var out = {};
        Object.keys(object).forEach(function (key) {
            var value = object[key];
            if (value === undefined) return;
            out[key] = value && typeof value === 'object' && !Array.isArray(value) ? withoutUndefined(value) : value;
        });
        return out;
    }

    /**
     * What a signup records about the visit: the app's ISignupMetadata. Without
     * consent to track (trackingAllowed), only the campaign the link named (UTM) and
     * whether the address is a throwaway one: nothing about the device or the visit.
     */
    function signupMetadata(email) {
        var params = new URLSearchParams(location.search);
        var utm = {};
        ['source', 'medium', 'campaign', 'content', 'term'].forEach(function (k) {
            var value = params.get('utm_' + k);
            if (value) utm['utm' + k.charAt(0).toUpperCase() + k.slice(1)] = value;
        });
        var domain = String(email || '').split('@')[1];
        var disposable = !!domain && DISPOSABLE_DOMAINS.indexOf(domain.toLowerCase()) !== -1;
        if (!visit.allowed) return Object.assign({}, utm, { isDisposableEmail: disposable });
        var ua = navigator.userAgent;
        var conn = navigator.connection;
        var query = {};
        params.forEach(function (value, key) { if (!/^utm_(source|medium|campaign|content|term)$|^ref$/.test(key)) query[key] = value; });
        var fcp;
        try {
            var paint = performance.getEntriesByName('first-contentful-paint');
            if (paint.length) fcp = Math.round(paint[0].startTime);
        } catch (e) { /* no Performance API */ }
        var data = loadSession();
        var now = new Date();
        var onPage = Date.now() - visit.loadedAt;
        return withoutUndefined(Object.assign({}, utm, {
            deviceType: detectDeviceType(ua),
            operatingSystem: detectOS(ua),
            browser: detectBrowser(ua),
            browserVersion: detectBrowserVersion(ua),
            screenResolution: screen.width + 'x' + screen.height,
            language: navigator.language || undefined,
            connectionType: (conn && conn.effectiveType) || undefined,
            downlinkSpeed: (conn && conn.downlink) || undefined,
            prefersDarkMode: window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : undefined,
            viewportSize: window.innerWidth + 'x' + window.innerHeight,
            isTouchDevice: ('ontouchstart' in window) || navigator.maxTouchPoints > 0,
            timezoneOffset: now.getTimezoneOffset(),
            signupHour: now.getHours(),
            signupDayOfWeek: now.getDay(),
            pageLoadTimeMs: fcp,
            referrerUrl: document.referrer || undefined,
            landingPage: location.href,
            pageLoadTimestamp: visit.loadedAt,
            queryParams: Object.keys(query).length ? query : undefined,
            timeOnPageMs: onPage,
            scrollDepthPercent: visit.maxScroll,
            isReturnVisitor: data.visitCount > 1,
            visitCount: data.visitCount,
            firstVisitTimestamp: data.firstVisitTimestamp || undefined,
            lastVisitTimestamp: data.lastVisitTimestamp || undefined,
            totalTimeOnPageMs: data.totalTimeOnPageMs + onPage,
            maxScrollDepthPercent: visit.maxScroll,
            formStartCount: data.formStartCount || undefined,
            clickCount: visit.clicks || undefined,
            tabSwitchCount: visit.tabSwitches || undefined,
            isDisposableEmail: disposable,
        }));
    }

    /** The hidden input a signup form carries for the server's spam check (joinForm's HONEYPOT_FIELD). */
    var SIGNUP_TRAP = 'arc_website';

    /**
     * An input people never see or fill; a bot filling every input does, and the
     * server then quietly drops what it sent.
     */
    function addTrap(form, name) {
        if (form.querySelector('input[name="' + name + '"]')) return;
        var trap = document.createElement('input');
        trap.type = 'text';
        trap.name = name;
        trap.tabIndex = -1;
        trap.autocomplete = 'off';
        trap.setAttribute('aria-hidden', 'true');
        trap.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;';
        form.appendChild(trap);
    }

    function trapValue(form, name) {
        var trap = form.querySelector('input[name="' + name + '"]');
        return trap ? trap.value : '';
    }

    function formValues(form) {
        var data = {};
        for (var i = 0; i < form.elements.length; i++) {
            var el = form.elements[i];
            if (!el.name || el.name === SIGNUP_TRAP || el.disabled || el.type === 'submit' || el.type === 'button') continue;
            if (el.type === 'checkbox') {
                if (el.checked) data[el.name] = data[el.name] ? data[el.name] + ', ' + el.value : el.value;
            } else if (el.type === 'radio') {
                if (el.checked) data[el.name] = el.value;
            } else {
                data[el.name] = el.value;
            }
        }
        return data;
    }

    function render(form, html) { form.innerHTML = html; }

    /**
     * Takes the form's own inputs out while a step shows, keeping them, and what was
     * typed in them, for showFields to put back.
     */
    function hideFields(form, state) {
        if (state.fields) return;
        var kept = document.createDocumentFragment();
        while (form.firstChild) kept.appendChild(form.firstChild);
        state.fields = kept;
    }

    /** Puts the form's own inputs back, as they were left. */
    function showFields(form, state) {
        if (!state.fields) return;
        form.innerHTML = '';
        form.appendChild(state.fields);
        state.fields = null;
    }

    /** The line in the form saying what went wrong ('' clears it), created on first use. */
    function formStatus(form, message) {
        var el = form.querySelector('[data-waitlist-status]');
        if (!el && !message) return;
        if (!el) {
            el = document.createElement('p');
            el.setAttribute('data-waitlist-status', '');
            el.setAttribute('role', 'alert');
            el.className = 'waitlist-form-error';
            el.style.cssText = 'color:#b42318;font-size:0.9rem;margin:0.5rem 0;';
            form.appendChild(el);
        }
        el.textContent = message;
        el.hidden = !message;
    }

    /** Back to the filled-in form after a failure, with the reason under it and the address focused. */
    function backToForm(form, state, message) {
        state.step = 'signup';
        showFields(form, state);
        formStatus(form, message);
        var emailInput = form.querySelector('[data-waitlist-email], [name="email"]');
        if (emailInput) emailInput.focus();
    }

    function loading(form, message) {
        render(form, '<div class="waitlist-loading"><div class="waitlist-spinner"></div><p>' + escapeHtml(message) + '</p></div>');
    }

    function inline(form, message, ok) {
        var el = form.querySelector('.waitlist-inline-message');
        if (el) el.innerHTML = '<span class="' + (ok ? 'waitlist-success-msg' : 'waitlist-error-msg') + '">' + escapeHtml(message) + '</span>';
    }

    var CARD = 'max-width:500px;margin:20px auto;padding:30px;border-radius:12px;background:#fff;box-shadow:0 4px 20px rgba(0,0,0,.1);font-family:sans-serif;text-align:center;border:1px solid #eaeaea;';
    var BUTTON = 'width:100%;padding:14px;background-color:#007bff;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;';
    var LINK = 'background:none;border:none;cursor:pointer;padding:0;font-size:14px;';
    var ICON = 'width:60px;height:60px;background-color:#4BB543;color:#fff;border-radius:50%;font-size:30px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;';

    /**
     * The form an id posts to, with its document. Only the default id is looked up
     * further, as the app does: an install whose default form predates it, under a
     * legacy id, keeps using that form instead of starting a new, empty one.
     * Resolves to { id, waitlist } (waitlist null when no such form exists yet).
     */
    function resolveForm(requested) {
        var read = function (id) { return readDoc('Waitlists/' + encodeURIComponent(id)).catch(function () { return null; }); };
        if (requested !== DEFAULT_FORM) return read(requested).then(function (waitlist) { return { id: requested, waitlist: waitlist }; });
        if (!defaultForm) {
            var candidates = [DEFAULT_FORM].concat(LEGACY_DEFAULT_FORMS);
            defaultForm = candidates.reduce(function (found, id) {
                return found.then(function (result) {
                    return result || read(id).then(function (waitlist) { return waitlist ? { id: id, waitlist: waitlist } : null; });
                });
            }, Promise.resolve(null)).then(function (result) { return result || { id: DEFAULT_FORM, waitlist: null }; });
        }
        return defaultForm;
    }

    function bindForm(form) {
        var requested = form.getAttribute('data-waitlist-id') || DEFAULT_FORM;
        var state = { step: 'signup', waitlistId: requested, fields: null, email: '', firstName: '' };
        addTrap(form, SIGNUP_TRAP);

        resolveForm(requested).then(function (found) {
            state.waitlistId = found.id;
            var waitlist = found.waitlist;
            if (!waitlist) {
                // The default form is created by the server on first use. Any other
                // form needs an admin to create it, so nothing is asked for.
                if (found.id !== DEFAULT_FORM && found.id !== 'default') return null;
                return call('ensureWaitlistExists', { waitlistId: found.id }).catch(function () { return null; });
            }
            if (waitlist.isActive === false) {
                form.style.position = 'relative';
                form.insertAdjacentHTML('beforeend', '<div class="waitlist-disabled-overlay" style="position:absolute;inset:0;background:rgba(255,255,255,.95);display:flex;align-items:center;justify-content:center;z-index:10;border-radius:12px;">'
                    + '<div style="text-align:center;padding:30px;"><div style="font-size:3rem;margin-bottom:15px;">🔒</div>'
                    + '<h3 style="color:#1a202c;margin:0 0 10px;font-size:1.5rem;font-weight:700;">' + escapeHtml(t('signup_closed_title', 'Waitlist Closed')) + '</h3>'
                    + '<p style="color:#64748b;margin:0;line-height:1.5;">' + escapeHtml(waitlist.disabledMessage || t('signup_closed_body', 'This waitlist is currently full. Please check back later for updates.')) + '</p></div></div>');
                state.closed = true;
            }
            state.otpEnabled = waitlist.otpEnabled !== false;
        }).catch(function () { /* a failed read leaves the form usable */ });

        form.addEventListener('submit', function (event) { submit(event, form, state); });
        form.addEventListener('focusin', trackFormStart);
    }

    function submit(event, form, state) {
        event.preventDefault();
        if (state.step !== 'signup' || state.closed) return;
        var data = formValues(form);
        var emailInput = form.querySelector('[data-waitlist-email], [name="email"]');
        var nameInput = form.querySelector('[data-waitlist-name], [name="firstName"], [name="name"]');
        var sourceInput = form.querySelector('[data-waitlist-source], [name="source"]');
        if (!emailInput || !emailInput.value.trim()) {
            formStatus(form, t('signup_email_required', 'Email is required'));
            if (emailInput) emailInput.focus();
            return;
        }
        formStatus(form, '');

        state.email = emailInput.value.trim().toLowerCase();
        state.firstName = (nameInput && nameInput.value.trim()) || firstNameFrom(state.email);
        var source = (sourceInput && sourceInput.value) || 'direct';
        var request = {
            waitlistId: state.waitlistId,
            email: state.email,
            firstName: state.firstName,
            source: source,
            formData: data,
            signupMetadata: signupMetadata(state.email),
            origin: location.origin,
        };
        request[SIGNUP_TRAP] = trapValue(form, SIGNUP_TRAP);
        state.step = 'joining';
        hideFields(form, state);
        loading(form, t('signup_loading', 'Signing you up...'));

        call('joinForm', request).then(function (joined) {
            // A sealed, short-lived ticket, never the member id: the later steps take it.
            state.ticket = joined && joined.ticket;
            return Promise.all([
                call('requestFormOtp', { waitlistId: state.waitlistId, ticket: state.ticket }).catch(function () { return null; }),
                readDoc('Settings/email_status').catch(function () { return null; }),
            ]);
        }).then(function (results) {
            var emailOn = !!(results[1] && results[1].isEnabled);
            if (!emailOn || state.otpEnabled === false) return confirm(form, state);
            state.step = 'verify';
            showVerify(form, state);
        }).catch(function (error) {
            backToForm(form, state, formError(error, t('signup_failed', 'Failed to sign up. Please try again.'), 'join'));
        });
    }

    /** Completes a signup whose code was checked, or that needed none. */
    function confirm(form, state) {
        loading(form, t('signup_verifying', 'Verifying...'));
        return call('finalizeFormSignup', { waitlistId: state.waitlistId, ticket: state.ticket })
            .then(function (finalized) {
                state.existing = !!finalized.alreadyConfirmed;
                state.step = state.existing ? 'existing-user' : 'success';
                if (state.existing) showExisting(form, state);
                else showSuccess(form, state);
            })
            .catch(function (error) {
                backToForm(form, state, formError(error, t('signup_verify_failed', 'Verification failed. Please try again.')));
            });
    }

    function showVerify(form, state) {
        render(form, '<div class="waitlist-verify-step" style="' + CARD + '">'
            + '<h3 style="margin-top:0;color:#1a1a1a;font-size:24px;font-weight:700;">' + escapeHtml(t('signup_check_email', 'Check your email')) + '</h3>'
            + '<p style="color:#666;line-height:1.5;font-size:15px;margin-bottom:25px;">' + escapeHtml(t('signup_code_sent_to', 'We sent a 6-digit verification code to')) + '<br><strong style="color:#1a1a1a;">' + escapeHtml(state.email) + '</strong></p>'
            + '<div style="margin-bottom:15px;"><input type="text" class="waitlist-otp-input" placeholder="000000" maxlength="6" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]*" style="width:100%;padding:12px;font-size:24px;letter-spacing:8px;text-align:center;border:2px solid #ddd;border-radius:8px;box-sizing:border-box;"></div>'
            + '<div class="waitlist-inline-message" style="margin-bottom:15px;color:#d93025;font-size:13px;min-height:18px;"></div>'
            + '<button type="button" class="waitlist-verify-btn" style="' + BUTTON + '">' + escapeHtml(t('signup_verify_button', 'Verify your email')) + '</button>'
            + '<div style="margin-top:20px;font-size:14px;display:flex;align-items:center;justify-content:center;gap:10px;">'
            + '<button type="button" class="waitlist-resend-btn" style="' + LINK + 'color:#007bff;text-decoration:underline;">' + escapeHtml(t('signup_resend', 'Resend code')) + '</button><span style="color:#ccc;">|</span>'
            + '<button type="button" class="waitlist-back-btn" style="' + LINK + 'color:#666;">' + escapeHtml(t('signup_change_email', 'Change email')) + '</button></div></div>');

        var otp = form.querySelector('.waitlist-otp-input');
        form.querySelector('.waitlist-verify-btn').addEventListener('click', function () {
            var code = (otp.value || '').trim();
            if (!/^\d{6}$/.test(code)) return inline(form, t('signup_code_format', 'Please enter a 6-digit code'));
            loading(form, t('signup_verifying', 'Verifying...'));
            call('verifyFormOtp', { waitlistId: state.waitlistId, ticket: state.ticket, code: code }).then(function (result) {
                if (!result || !result.verified) throw new Error(t('signup_code_invalid', 'Invalid or expired code'));
                return confirm(form, state);
            }).catch(function (error) {
                showVerify(form, state);
                inline(form, formError(error, t('signup_code_invalid', 'Invalid or expired code'), 'verify'));
            });
        });
        form.querySelector('.waitlist-resend-btn').addEventListener('click', function () {
            call('requestFormOtp', { waitlistId: state.waitlistId, ticket: state.ticket })
                .then(function () { inline(form, t('signup_code_resent', 'New code sent to your email!'), true); })
                .catch(function (error) { inline(form, formError(error, t('signup_resend_failed', 'Failed to resend code'))); });
        });
        form.querySelector('.waitlist-back-btn').addEventListener('click', function () { reset(form, state); });
        if (otp) otp.focus();
    }

    /**
     * The form's own wording for a panel, from a data attribute on the form
     * element, with {email} and {name} filled in. Single braces, because a content
     * template empties every {{ … }} its item does not fill when it is published;
     * {{ email }} still works where it survives. Empty when the form has none.
     */
    function formText(form, attribute, state) {
        var text = form.getAttribute(attribute);
        if (!text || !text.trim()) return '';
        return text.replace(/\{\{\s*(\w+)\s*\}\}|\{(\w+)\}/g, function (match, double, single) {
            var name = double || single;
            if (name === 'email') return state.email;
            if (name === 'name') return state.firstName;
            return match;
        });
    }

    /** A tick, a title and one line: what a finished signup shows. */
    function showDone(form, stepClass, title, text) {
        render(form, '<div class="' + stepClass + '" style="' + CARD + '">'
            + '<div class="waitlist-success-icon" style="' + ICON + '">✓</div>'
            + '<h3 class="waitlist-success-title" style="margin:0 0 10px;font-size:24px;color:#1a1a1a;">' + escapeHtml(title) + '</h3>'
            + '<p class="waitlist-success-text" style="margin:0;font-size:16px;line-height:1.5;color:#666;overflow-wrap:anywhere;">' + escapeHtml(text) + '</p></div>');
    }

    function showSuccess(form, state) {
        var params = { email: state.email, name: state.firstName };
        showDone(form, 'waitlist-success-step',
            formText(form, 'data-waitlist-success-title', state) || t('signup_on_list', 'You\'re on the list!'),
            formText(form, 'data-waitlist-success-text', state) || t('signup_success_text', 'We\'ll be in touch at {{ email }}.', params));
    }

    /** Someone already on the list. */
    function showExisting(form, state) {
        var params = { email: state.email, name: state.firstName };
        showDone(form, 'waitlist-existing-step',
            formText(form, 'data-waitlist-existing-title', state)
                || (state.firstName ? t('signup_welcome_back_name', 'Welcome back, {{ name }}!', params) : t('signup_welcome_back', 'Welcome back!')),
            formText(form, 'data-waitlist-existing-text', state) || t('signup_already', 'You\'re already on the list.', params));
    }

    /** "Change email": the form again, as it was filled in. */
    function reset(form, state) {
        backToForm(form, state, '');
    }

    // ─── Counts ────────────────────────────────────────────────────────────

    function updateCounts() {
        var cache = {};
        Array.prototype.forEach.call(document.querySelectorAll('[data-waitlist-count]'), function (el) {
            var id = el.getAttribute('data-waitlist-count');
            if (!id) {
                var form = (el.closest('section') || document).querySelector('form[data-waitlist-id]') || document.querySelector('form[data-waitlist-id]');
                id = (form && form.getAttribute('data-waitlist-id')) || DEFAULT_FORM;
            }
            cache[id] = cache[id] || resolveForm(id);
            cache[id].then(function (found) {
                var count = Number((found.waitlist && found.waitlist.totalSignups) || 0);
                el.classList.remove('arc-skeleton');
                el.textContent = String(count);
                var bar = el.closest('section') && el.closest('section').querySelector('.fc-progress-fill');
                if (bar) bar.style.width = Math.min(count, 100) + '%';
            });
        });
    }

    // ─── Installable app ───────────────────────────────────────────────────

    var site = window.arcSite = window.arcSite || {};
    var deferredPrompt = null;
    site.canInstall = false;
    site.install = function () {
        if (!deferredPrompt) return Promise.resolve(false);
        var prompt = deferredPrompt;
        deferredPrompt = null;
        prompt.prompt();
        return prompt.userChoice.then(function (choice) { return choice && choice.outcome === 'accepted'; });
    };

    function setupInstall() {
        if (!document.querySelector('link[rel="manifest"]')) return;
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () { /* the page still works */ });
        }
        window.addEventListener('beforeinstallprompt', function (event) {
            event.preventDefault();
            deferredPrompt = event;
            site.canInstall = true;
            Array.prototype.forEach.call(document.querySelectorAll('[data-arc-install]'), function (button) {
                button.hidden = false;
            });
            document.dispatchEvent(new CustomEvent('arcsite:installable'));
        });
        document.addEventListener('click', function (event) {
            var button = event.target.closest && event.target.closest('[data-arc-install]');
            if (button) { event.preventDefault(); site.install(); }
        });
    }

    // ─── Signed in ─────────────────────────────────────────────────────────

    function applySignedIn() {
        var signedIn = false;
        try { signedIn = localStorage.getItem(SIGNED_IN_KEY) === '1'; } catch (e) { /* storage off */ }
        site.signedIn = signedIn;
        document.documentElement.classList.toggle('arc-signed-in', signedIn);
        Array.prototype.forEach.call(document.querySelectorAll('[data-arc-signed-in]'), function (el) { el.hidden = !signedIn; });
        Array.prototype.forEach.call(document.querySelectorAll('[data-arc-signed-out]'), function (el) { el.hidden = signedIn; });
    }

    // ─── Contact forms ─────────────────────────────────────────────────────

    var CONTACT_FIELDS = ['name', 'email', 'phone', 'subject', 'message'];
    var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    /** A line under the form for what went wrong, created on first use. */
    function contactStatus(form, message) {
        var el = form.querySelector('[data-contact-status]');
        if (!el) {
            el = document.createElement('p');
            el.setAttribute('data-contact-status', '');
            el.setAttribute('role', 'alert');
            el.className = 'arc-contact-error';
            el.style.cssText = 'color:#b42318;font-size:0.9rem;margin:0.5rem 0;';
            form.appendChild(el);
        }
        el.textContent = message;
    }

    function bindContactForm(form) {
        if (form.hasAttribute('data-arc-bound')) return;
        form.setAttribute('data-arc-bound', '');
        addTrap(form, 'website');
        form.addEventListener('submit', function (event) {
            event.preventDefault();
            sendContact(form);
        });
    }

    function sendContact(form) {
        var data = {
            page: location.pathname,
            lang: document.documentElement.lang || '',
            elapsedMs: Date.now() - visit.loadedAt,
            website: form.elements.namedItem('website') ? form.elements.namedItem('website').value : '',
        };
        CONTACT_FIELDS.forEach(function (name) {
            var input = form.elements.namedItem(name);
            if (input && typeof input.value === 'string') data[name] = input.value.trim();
        });
        if (!data.email || !EMAIL_PATTERN.test(data.email)) {
            contactStatus(form, t('contact_invalid_email', 'Please enter a valid email address.'));
            if (form.elements.namedItem('email')) form.elements.namedItem('email').focus();
            return;
        }
        if (!data.message) {
            contactStatus(form, t('contact_no_message', 'Please write a message.'));
            if (form.elements.namedItem('message')) form.elements.namedItem('message').focus();
            return;
        }

        var button = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
        var label = button ? (button.tagName === 'INPUT' ? button.value : button.textContent) : '';
        var setButton = function (text, busy) {
            if (!button) return;
            button.disabled = busy;
            if (button.tagName === 'INPUT') button.value = text; else button.textContent = text;
        };
        setButton(t('contact_sending', 'Sending...'), true);

        call('submitContactMessage', data).then(function () {
            render(form, '<p class="arc-contact-sent" role="status" style="margin:0;">'
                + escapeHtml(t('contact_sent', 'Thank you. Your message is on its way, and we will reply soon.')) + '</p>');
        }).catch(function (error) {
            setButton(label, false);
            contactStatus(form, error.code === 'RESOURCE_EXHAUSTED'
                ? t('contact_too_many', 'You have sent several messages already. Please try again in an hour.')
                : error.code === 'INVALID_ARGUMENT'
                    ? t('contact_invalid', 'Please check your email address and message, then send again.')
                    : t('contact_error', 'Your message could not be sent. Please try again.'));
        });
    }

    // ─── Setup ─────────────────────────────────────────────────────────────

    /**
     * The same rule as the app (onboarding-setup.service.ts): a fresh install sends
     * everyone to the wizard, an unfinished one only someone signed in (who may be
     * the person running it; the wizard tells anyone else).
     */
    function checkSetup() {
        if (!config.setup || !config.project || new URLSearchParams(location.search).has('debug')) return;
        readDoc('Settings/onboarding_status').then(function (status) {
            var pending = status
                ? status.completed !== true && site.signedIn
                : config.setup === 'first-run';
            if (pending) site._internal.redirect('/onboarding');
        }).catch(function () { /* cannot tell: stay */ });
    }

    // ─── Start ─────────────────────────────────────────────────────────────

    function start() {
        try { localStorage.removeItem(OLD_REFERRAL_KEY); } catch (e) { /* storage off */ }
        applySignedIn();
        checkSetup();
        setupInstall();
        var forms = document.querySelectorAll('form[data-waitlist-form]');
        if (config.functions && forms.length) {
            Array.prototype.forEach.call(forms, bindForm);
            trackingAllowed().then(function (allowed) {
                visit.allowed = allowed;
                if (allowed) startTracking();
            });
        }
        var contactForms = document.querySelectorAll('form[data-arc-contact-form]');
        if (config.functions) Array.prototype.forEach.call(contactForms, bindContactForm);
        if (config.project) updateCounts();
    }

    site._internal = {
        call: call, readDoc: readDoc, plain: plain, signupMetadata: signupMetadata,
        redirect: function (url) { location.replace(url); },
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
