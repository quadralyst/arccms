/**
 * The admin surfaces that follow the features (docs/feature-flags-spec.md, F2):
 * what each one leaves out when a feature is off.
 */
import { describe, expect, it } from 'vitest';
import { withoutFeaturesOff, type MenuItem } from '../../../shared/components/side-navbar/side-navbar.component';
import { exportableKnownCollections, KNOWN_COLLECTIONS } from '../../pages/admin/(data)/data-constants';
import { templateFeature } from '../../pages/admin/(email-composer)/email-composer.page';
import type { FeatureId } from './feature-registry';
import { featureOfPath, featureOffMatcher, whenOn } from './feature-routes';
import { phoneSignInOn } from '../../pages/admin/(settings)/user-setting/user-setting.model';

const allOn = () => true;
const offOnly = (...off: FeatureId[]) => (id: FeatureId) => !off.includes(id);
const labels = (items: MenuItem[]) => items.map((i) => (i.separator ? '|' : i.label));

describe('sidebar without features that are off', () => {
    const sep: MenuItem = { label: '', separator: true };
    const menu: MenuItem[] = [
        { label: 'Dashboard' },
        { label: 'Signup Forms', feature: 'forms' },
        { label: 'Media Manager' },
        sep,
        { label: 'Content', feature: 'content', subItems: [{ label: 'Content types' }] },
        sep,
        { label: 'Users' },
        { label: 'Email', subItems: [{ label: 'Composer' }, { label: 'SMS Logs', feature: 'sms' }] },
        { label: 'Data', subItems: [{ label: 'Export', feature: 'data' }] },
        sep,
    ];

    it('keeps everything when every feature is on, minus a trailing separator', () => {
        expect(labels(withoutFeaturesOff(menu, allOn))).toEqual(
            ['Dashboard', 'Signup Forms', 'Media Manager', '|', 'Content', '|', 'Users', 'Email', 'Data']);
    });

    it('drops items, sub-items and groups left empty, and never doubles a separator', () => {
        const kept = withoutFeaturesOff(menu, offOnly('forms', 'content', 'sms', 'data'));
        expect(labels(kept)).toEqual(['Dashboard', 'Media Manager', '|', 'Users', 'Email']);
        expect(kept.find((i) => i.label === 'Email')?.subItems?.map((i) => i.label)).toEqual(['Composer']);
    });

    it('never starts with a separator', () => {
        expect(labels(withoutFeaturesOff([sep, { label: 'Users' }], allOn))).toEqual(['Users']);
    });

    it('leaves the menu it was given alone', () => {
        withoutFeaturesOff(menu, offOnly('sms'));
        expect(menu[7].subItems).toHaveLength(2);
    });
});

describe('data export without features that are off', () => {
    it('offers every known collection when every feature is on', () => {
        expect(exportableKnownCollections(allOn)).toEqual(KNOWN_COLLECTIONS);
    });

    it('leaves out the collections of features that are off, and keeps unsubscribes', () => {
        const names = exportableKnownCollections(offOnly('forms', 'audience', 'email-marketing', 'content')).map((c) => c.name);
        expect(names).toEqual(['users', 'Settings', 'media', 'EmailTemplate', 'EmailLogs', 'Suppression']);
    });
});

describe('email composer template features', () => {
    it('knows the form and payment templates, and nothing else', () => {
        expect(templateFeature('waitlist_welcome_email')).toBe('forms');
        expect(templateFeature('payment_succeeded_email')).toBe('payments');
        expect(templateFeature('trial_ending_email')).toBe('payments');
        expect(templateFeature('signup_otp_email')).toBeUndefined();
        expect(templateFeature('my_newsletter')).toBeUndefined();
    });
});

describe('feature URLs', () => {
    const path = (url: string) => url.split('/').filter(Boolean);

    it('knows which feature owns a URL, including the file router second URLs', () => {
        expect(featureOfPath(path('/admin/email/broadcasts'))).toBe('email-marketing');
        expect(featureOfPath(path('/admin/broadcasts'))).toBe('email-marketing');
        expect(featureOfPath(path('/admin/waitlists/dashboard/abc'))).toBe('forms');
        expect(featureOfPath(path('/checkout/success'))).toBe('payments');
        expect(featureOfPath(path('/user/payments'))).toBe('payments');
        expect(featureOfPath(path('/admin/settings/sms'))).toBe('sms');
        expect(featureOfPath(path('/admin/contents/blog/edit/1'))).toBe('content');
    });

    it('leaves core URLs alone', () => {
        for (const url of ['/', '/admin/dashboard', '/admin/users', '/admin/settings', '/admin/settings/user',
            '/admin/email/composer', '/admin/email-logs', '/user/dashboard', '/user/profile', '/unsubscribe/x', '/signup']) {
            expect(featureOfPath(path(url))).toBeUndefined();
        }
    });

    it('matches a whole segment, not a prefix of one', () => {
        expect(featureOfPath(path('/pricingx'))).toBeUndefined();
        expect(featureOfPath(path('/search/more'))).toBeUndefined();
    });

    it('answers the URLs of features that are off, consuming the whole URL', () => {
        const segments = (url: string) => path(url).map((p) => ({ path: p }) as never);
        const matcher = featureOffMatcher(offOnly('payments'));
        const url = segments('/checkout/success');
        expect(matcher(url, {} as never, {} as never)).toEqual({ consumed: url });
        expect(matcher(segments('/admin/waitlists'), {} as never, {} as never)).toBeNull();
        expect(matcher(segments('/admin/users'), {} as never, {} as never)).toBeNull();
    });

    it('keeps or drops a feature\'s own routes', () => {
        expect(whenOn('forms', [{ path: 'x' }], allOn)).toEqual([{ path: 'x' }]);
        expect(whenOn('forms', [{ path: 'x' }], offOnly('forms'))).toEqual([]);
    });
});

describe('phone sign-in', () => {
    it('needs both the setting and the SMS feature', () => {
        expect(phoneSignInOn({ phoneSignIn: true }, true)).toBe(true);
        expect(phoneSignInOn({ phoneSignIn: true }, false)).toBe(false);
        expect(phoneSignInOn({ phoneSignIn: false }, true)).toBe(false);
        expect(phoneSignInOn(null, true)).toBe(false);
    });
});
