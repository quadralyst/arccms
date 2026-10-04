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
 *   waitlist.service.ts): join, the emailed code when the form asks for one, the
 *   position and referral link. The terms notice is added by the publish pipeline,
 *   and by the app's preview of the home page (src/app/pages/index.page.ts), which
 *   runs this same script.
 * - Live counts, <span data-waitlist-count="form-id">: confirmed sign-ups.
 * - Referral codes from ?ref=, kept for the next sign-up (as the app does).
 * - Signup metadata: the same fields and visitor history as the app's forms
 *   (device, UTM, visits, scroll depth, time on page), and "Welcome back" for
 *   someone already on the list.
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

    var REFERRAL_KEY = 'arc_referral';
    var REFERRAL_HOURS = 24 * 30;
    var SIGNED_IN_KEY = 'arc:signed-in';
    var DEFAULT_FORM = 'waitlist-form';
    /** Where installs from before the default form id kept their default form (src/shared/constants/waitlist-form.ts). */
    var LEGACY_DEFAULT_FORMS = ['get-early-access-to-arc-cms', 'default'];
    var defaultForm = null;

    // ─── Server ────────────────────────────────────────────────────────────

    /** A callable by its plain name; rejects with the server's message. */
    function call(name, data) {
        return fetch(config.functions.replace(/\/+$/, '') + '/' + config.group + '-' + name, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: data }),
        }).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (body) {
                if (!res.ok || body.error) {
                    var error = new Error((body.error && body.error.message) || 'Request failed');
                    error.code = body.error && body.error.status;
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

    // ─── Referral codes ────────────────────────────────────────────────────

    function storeReferral(code) {
        try {
            localStorage.setItem(REFERRAL_KEY, JSON.stringify({ code: code, expiration: Date.now() + REFERRAL_HOURS * 3600 * 1000 }));
        } catch (e) { /* storage off */ }
    }

    function storedReferral() {
        try {
            var data = JSON.parse(localStorage.getItem(REFERRAL_KEY) || 'null');
            if (!data) return '';
            if (Date.now() > data.expiration) { localStorage.removeItem(REFERRAL_KEY); return ''; }
            return data.code || '';
        } catch (e) { return ''; }
    }

    function clearReferral() {
        try { localStorage.removeItem(REFERRAL_KEY); } catch (e) { /* storage off */ }
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

    function referralLinkFor(code) {
        return location.origin + location.pathname + '?ref=' + encodeURIComponent(code || '');
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
    var visit = { loadedAt: Date.now(), maxScroll: 0, clicks: 0, tabSwitches: 0, formStarted: false, tracking: false, session: null };

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
        if (visit.formStarted) return;
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

    /** What a signup records about the visit: the app's ISignupMetadata. */
    function signupMetadata(email) {
        var params = new URLSearchParams(location.search);
        var ua = navigator.userAgent;
        var conn = navigator.connection;
        var utm = {};
        ['source', 'medium', 'campaign', 'content', 'term'].forEach(function (k) {
            var value = params.get('utm_' + k);
            if (value) utm['utm' + k.charAt(0).toUpperCase() + k.slice(1)] = value;
        });
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
        var domain = String(email || '').split('@')[1];
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
            isDisposableEmail: !!domain && DISPOSABLE_DOMAINS.indexOf(domain.toLowerCase()) !== -1,
        }));
    }

    function formValues(form) {
        var data = {};
        for (var i = 0; i < form.elements.length; i++) {
            var el = form.elements[i];
            if (!el.name || el.disabled || el.type === 'submit' || el.type === 'button') continue;
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
    var STAT = 'font-size:22px;font-weight:700;color:#2563eb;';
    var STAT_LABEL = 'font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#666;margin-top:4px;';

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
        var state = { step: 'signup', waitlistId: requested, original: form.innerHTML, email: '', firstName: '' };

        resolveForm(requested).then(function (found) {
            state.waitlistId = found.id;
            var waitlist = found.waitlist;
            if (!waitlist) {
                // Created by the server on first use, as in the app.
                return call('ensureWaitlistExists', { waitlistId: found.id }).catch(function () { return null; });
            }
            if (waitlist.isActive === false) {
                form.style.position = 'relative';
                form.insertAdjacentHTML('beforeend', '<div class="waitlist-disabled-overlay" style="position:absolute;inset:0;background:rgba(255,255,255,.95);display:flex;align-items:center;justify-content:center;z-index:10;border-radius:12px;">'
                    + '<div style="text-align:center;padding:30px;"><div style="font-size:3rem;margin-bottom:15px;">🔒</div>'
                    + '<h3 style="color:#1a202c;margin:0 0 10px;font-size:1.5rem;font-weight:700;">Waitlist Closed</h3>'
                    + '<p style="color:#64748b;margin:0;line-height:1.5;">' + escapeHtml(waitlist.disabledMessage || 'This waitlist is currently full. Please check back later for updates.') + '</p></div></div>');
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
        if (!emailInput || !emailInput.value.trim()) return showError(form, state, 'Email is required');

        state.email = emailInput.value.trim().toLowerCase();
        state.firstName = (nameInput && nameInput.value.trim()) || firstNameFrom(state.email);
        var source = (sourceInput && sourceInput.value) || 'direct';
        loading(form, 'Signing you up...');

        call('joinForm', {
            waitlistId: state.waitlistId,
            email: state.email,
            firstName: state.firstName,
            source: source,
            referredBy: '',
            formData: data,
            signupMetadata: signupMetadata(state.email),
            origin: location.origin,
        }).then(function (joined) {
            state.memberId = joined.memberId;
            state.referralCode = joined.referralCode;
            state.referralLink = joined.referralLink || referralLinkFor(joined.referralCode);
            state.waitlistedUserId = joined.waitlistedUserId || joined.memberId;
            return Promise.all([
                call('requestFormOtp', { waitlistId: state.waitlistId, email: state.email, name: state.firstName }).catch(function () { return null; }),
                readDoc('Settings/email_status').catch(function () { return null; }),
            ]);
        }).then(function (results) {
            var emailOn = !!(results[1] && results[1].isEnabled);
            if (!emailOn || state.otpEnabled === false) return confirm(form, state, storedReferral());
            state.step = 'verify';
            showVerify(form, state);
        }).catch(function (error) {
            showError(form, state, (error && error.message) || 'Failed to sign up. Please try again.');
        });
    }

    /** Completes a signup whose code was checked, or that needed none. */
    function confirm(form, state, referredBy) {
        loading(form, 'Verifying...');
        return call('finalizeFormSignup', { waitlistId: state.waitlistId, userId: state.memberId, referredBy: referredBy || undefined })
            .then(function (finalized) {
                state.queuePosition = finalized.queuePosition;
                state.totalSignups = finalized.totalSignups;
                state.existing = !!finalized.alreadyConfirmed;
                if (referredBy && !state.existing) {
                    return call('creditReferral', {
                        waitlistId: state.waitlistId, referrerCode: referredBy, referredEmail: state.email,
                        referredName: state.firstName, referredMemberId: state.memberId, status: 'completed',
                    }).catch(function () { /* a referral must not fail the signup */ });
                }
            })
            .then(function () {
                clearReferral();
                state.step = state.existing ? 'existing-user' : 'success';
                if (state.existing) showExisting(form, state);
                else showSuccess(form, state);
            })
            .catch(function (error) {
                showError(form, state, (error && error.message) || 'Verification failed. Please try again.');
            });
    }

    function showVerify(form, state) {
        var hasReferral = !!storedReferral();
        render(form, '<div class="waitlist-verify-step" style="' + CARD + '">'
            + '<h3 style="margin-top:0;color:#1a1a1a;font-size:24px;font-weight:700;">Check Your Email</h3>'
            + '<p style="color:#666;line-height:1.5;font-size:15px;margin-bottom:25px;">We sent a 6-digit verification code to<br><strong style="color:#1a1a1a;">' + escapeHtml(state.email) + '</strong></p>'
            + '<div style="margin-bottom:15px;"><input type="text" class="waitlist-otp-input" placeholder="000000" maxlength="6" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]*" style="width:100%;padding:12px;font-size:24px;letter-spacing:8px;text-align:center;border:2px solid #ddd;border-radius:8px;box-sizing:border-box;"></div>'
            + (hasReferral ? '' : '<div style="margin-bottom:20px;"><input type="text" class="waitlist-referral-input" placeholder="Referral code (optional)" maxlength="10" style="width:100%;padding:10px;font-size:14px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;"></div>')
            + '<div class="waitlist-inline-message" style="margin-bottom:15px;color:#d93025;font-size:13px;min-height:18px;"></div>'
            + '<button type="button" class="waitlist-verify-btn" style="' + BUTTON + '">Verify Email</button>'
            + '<div style="margin-top:20px;font-size:14px;display:flex;align-items:center;justify-content:center;gap:10px;">'
            + '<button type="button" class="waitlist-resend-btn" style="' + LINK + 'color:#007bff;text-decoration:underline;">Resend code</button><span style="color:#ccc;">|</span>'
            + '<button type="button" class="waitlist-back-btn" style="' + LINK + 'color:#666;">Change email</button></div></div>');

        var otp = form.querySelector('.waitlist-otp-input');
        form.querySelector('.waitlist-verify-btn').addEventListener('click', function () {
            var code = (otp.value || '').trim();
            if (!/^\d{6}$/.test(code)) return inline(form, 'Please enter a 6-digit code');
            var referralInput = form.querySelector('.waitlist-referral-input');
            var referredBy = (referralInput && referralInput.value.trim()) || storedReferral();
            loading(form, 'Verifying...');
            call('verifyFormOtp', { waitlistId: state.waitlistId, email: state.email, code: code }).then(function (result) {
                if (!result || !result.verified) throw new Error('Invalid or expired code');
                return confirm(form, state, referredBy);
            }).catch(function (error) {
                showVerify(form, state);
                inline(form, (error && error.message) || 'Invalid verification code');
            });
        });
        form.querySelector('.waitlist-resend-btn').addEventListener('click', function () {
            call('requestFormOtp', { waitlistId: state.waitlistId, email: state.email, name: state.firstName })
                .then(function () { inline(form, 'New code sent to your email!', true); })
                .catch(function (error) { inline(form, (error && error.message) || 'Failed to resend code'); });
        });
        form.querySelector('.waitlist-back-btn').addEventListener('click', function () { reset(form, state); });
        if (otp) otp.focus();
    }

    function copyRow(label, value) {
        return '<div style="margin-bottom:15px;"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:#444;">' + label + '</label>'
            + '<div style="display:flex;gap:8px;"><input type="text" readonly value="' + escapeHtml(value) + '" class="waitlist-copy-input" style="flex:1;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-family:monospace;font-size:14px;">'
            + '<button type="button" class="waitlist-copy-btn" data-copy="' + escapeHtml(value) + '" style="padding:10px 16px;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;">📋 Copy</button></div></div>';
    }

    function showSuccess(form, state) {
        render(form, '<div class="waitlist-success-step" style="' + CARD + 'max-width:550px;border-radius:16px;">'
            + '<div style="width:60px;height:60px;background-color:#4BB543;color:#fff;border-radius:50%;font-size:30px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;">✓</div>'
            + '<h3 style="margin:0 0 25px;font-size:24px;color:#1a1a1a;">You\'re on the list!</h3>'
            + '<div style="display:flex;justify-content:space-around;background:#f8f9fa;padding:20px;border-radius:12px;margin-bottom:30px;">'
            + '<div style="flex:1;"><div class="waitlist-stat-number" style="' + STAT + '">#' + escapeHtml(state.queuePosition || 1) + '</div><div style="' + STAT_LABEL + '">Your Position</div></div>'
            + '<div style="flex:1;border-left:1px solid #e0e0e0;"><div class="waitlist-stat-number" style="' + STAT + '">' + escapeHtml(state.totalSignups || 1) + '</div><div style="' + STAT_LABEL + '">Total Signups</div></div></div>'
            + '<div style="border-top:1px solid #eee;padding-top:25px;text-align:left;">'
            + '<h4 style="margin:0 0 8px;font-size:18px;text-align:center;">🚀 Move up faster!</h4>'
            + '<p style="margin:0 0 20px;font-size:14px;color:#666;text-align:center;">Each verified referral moves you up in the queue.</p>'
            + copyRow('Your Referral Code:', state.referralCode || '') + copyRow('Share this link:', state.referralLink || '') + '</div>'
            + '<a href="/leaderboard/' + encodeURIComponent(state.waitlistId) + '/' + encodeURIComponent(state.waitlistedUserId || '') + '" class="waitlist-leaderboard-btn" style="display:block;text-decoration:none;padding:14px;background-color:#f0f4ff;color:#2563eb;border-radius:10px;font-weight:600;font-size:15px;">🏆 View Leaderboard</a></div>');
        bindCopyButtons(form);
    }

    /** Someone already on the list, as the app shows them. */
    function showExisting(form, state) {
        render(form, '<div class="waitlist-existing-step" style="' + CARD + 'max-width:450px;border-radius:16px;">'
            + '<div style="width:60px;height:60px;background-color:#2563eb;color:#fff;border-radius:50%;font-size:30px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;font-style:italic;font-family:serif;">i</div>'
            + '<h3 style="margin:0 0 10px;font-size:24px;color:#1a1a1a;">Welcome back' + (state.firstName ? ', ' + escapeHtml(state.firstName) : '') + '!</h3>'
            + '<p style="margin:0 0 25px;font-size:16px;color:#666;">You\'re already on the waitlist.</p>'
            + '<div style="display:flex;justify-content:space-around;background:#f8f9fa;padding:20px;border-radius:12px;margin-bottom:30px;">'
            + '<div style="flex:1;"><div class="waitlist-stat-number" style="' + STAT + '">#' + escapeHtml(state.queuePosition || 1) + '</div><div style="' + STAT_LABEL + '">Your Position</div></div></div>'
            + '<div style="text-align:left;">' + copyRow('Your Referral Code:', state.referralCode || '') + copyRow('Share this link:', state.referralLink || '') + '</div>'
            + '<a href="/leaderboard/' + encodeURIComponent(state.waitlistId) + '/' + encodeURIComponent(state.waitlistedUserId || '') + '" class="waitlist-leaderboard-btn" style="display:block;text-decoration:none;padding:14px;background-color:#f0f4ff;color:#2563eb;border-radius:10px;font-weight:600;font-size:15px;">🏆 View Leaderboard</a></div>');
        bindCopyButtons(form);
    }

    function bindCopyButtons(form) {
        Array.prototype.forEach.call(form.querySelectorAll('.waitlist-copy-btn'), function (btn) {
            btn.addEventListener('click', function () {
                var done = function () { var t = btn.textContent; btn.textContent = '✓ Copied!'; setTimeout(function () { btn.textContent = t; }, 2000); };
                if (navigator.clipboard) navigator.clipboard.writeText(btn.getAttribute('data-copy') || '').then(done, function () {});
            });
        });
    }

    function showError(form, state, message) {
        state.step = 'error';
        render(form, '<div class="waitlist-error-step" style="padding:20px;border-radius:12px;background:#fffafb;border:1px solid #f8d7da;text-align:center;font-family:sans-serif;">'
            + '<div style="font-size:48px;color:#dc3545;margin-bottom:15px;line-height:1;">⚠</div>'
            + '<h3 style="margin:0 0 10px;color:#721c24;font-size:22px;font-weight:700;">Something went wrong</h3>'
            + '<p class="waitlist-error-text" style="margin:0 0 25px;color:#842029;font-size:15px;line-height:1.5;">' + escapeHtml(message) + '</p>'
            + '<button type="button" class="waitlist-retry-btn" style="padding:12px 24px;background-color:#dc3545;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;">Try Again</button></div>');
        form.querySelector('.waitlist-retry-btn').addEventListener('click', function () { reset(form, state); });
    }

    function reset(form, state) {
        state.step = 'signup';
        form.innerHTML = state.original;
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
        var ref = new URLSearchParams(location.search).get('ref');
        if (ref) storeReferral(ref);
        applySignedIn();
        checkSetup();
        setupInstall();
        var forms = document.querySelectorAll('form[data-waitlist-form]');
        if (config.functions && forms.length) {
            startTracking();
            Array.prototype.forEach.call(forms, bindForm);
        }
        if (config.project) updateCounts();
    }

    site._internal = {
        call: call, readDoc: readDoc, plain: plain, storedReferral: storedReferral, signupMetadata: signupMetadata,
        redirect: function (url) { location.replace(url); },
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
