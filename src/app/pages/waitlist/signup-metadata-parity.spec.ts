/**
 * A signup from a published page (public/assets/js/arc-site.js) records the same
 * metadata as one from the app (signup-metadata.service.ts): the same fields,
 * under the same names. The two are separate code, one plain script and one
 * Angular service, so this keeps them from drifting apart.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SignupMetadataService } from './signup-metadata.service';

const ARC_SITE = readFileSync(join(__dirname, '../../../../public/assets/js/arc-site.js'), 'utf8');

type ArcSite = { arcSite: { _internal: { signupMetadata: (email: string) => Record<string, unknown> } } };

describe('signup metadata: published page and app', () => {
    afterEach(() => {
        delete (window as unknown as { arcSite?: unknown }).arcSite;
        localStorage.clear();
        history.replaceState({}, '', '/');
        vi.unstubAllGlobals();
    });

    // Without consent, both send the same two things.
    it('sends only the campaign and the throwaway flag without consent, the same from both', async () => {
        history.replaceState({}, '', '/?utm_source=news&plan=pro');
        localStorage.setItem('arc_site_usage', 'rejected');
        const fromApp = await TestBed.inject(SignupMetadataService).collectAllMetadata('asha@mailinator.com');
        document.body.innerHTML = '<form data-waitlist-form data-waitlist-id="launch"><input name="email"></form>'
            + '<script src="/assets/js/arc-site.js" data-functions="https://x" data-project="p"></script>';
        new Function(ARC_SITE)();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const fromPage = (window as unknown as ArcSite).arcSite._internal.signupMetadata('asha@mailinator.com');
        expect(fromPage).toEqual(fromApp);
        expect(fromApp).toEqual({ utmSource: 'news', isDisposableEmail: true });
    });

    it('collects the same fields under the same names', async () => {
        history.replaceState({}, '', '/?utm_source=news&utm_medium=email&utm_campaign=launch&utm_content=a&utm_term=b&ref=X&plan=pro');
        localStorage.setItem('arc_session_data', JSON.stringify({
            firstVisitTimestamp: 1, lastVisitTimestamp: 2, visitCount: 2, maxScrollDepthPercent: 40, totalTimeOnPageMs: 500, formStartCount: 1,
        }));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
        // Both track only with consent (RF6 6.12): this visitor accepted.
        localStorage.setItem('arc_site_usage', 'accepted');

        const service = TestBed.inject(SignupMetadataService);
        service.startBehaviorTracking();
        window.dispatchEvent(new Event('click'));
        const fromApp = await service.collectAllMetadata('asha@mailinator.com');

        localStorage.setItem('arc_session_data', JSON.stringify({
            firstVisitTimestamp: 1, lastVisitTimestamp: 2, visitCount: 2, maxScrollDepthPercent: 40, totalTimeOnPageMs: 500, formStartCount: 1,
        }));
        document.body.innerHTML = '<form data-waitlist-form data-waitlist-id="launch"><input name="email"></form>'
            + '<script src="/assets/js/arc-site.js" data-functions="https://x" data-project="p"></script>';
        new Function(ARC_SITE)();
        await new Promise((resolve) => setTimeout(resolve, 0));
        window.dispatchEvent(new Event('click'));
        const fromPage = (window as unknown as ArcSite).arcSite._internal.signupMetadata('asha@mailinator.com');

        expect(Object.keys(fromPage).sort()).toEqual(Object.keys(fromApp).sort());
        for (const key of ['utmSource', 'utmContent', 'utmTerm', 'deviceType', 'operatingSystem', 'browser', 'screenResolution', 'landingPage', 'isReturnVisitor', 'visitCount', 'isDisposableEmail']) {
            expect(fromPage[key], key).toEqual((fromApp as Record<string, unknown>)[key]);
        }
        expect(fromPage['queryParams']).toEqual({ plan: 'pro' });
    });
});
