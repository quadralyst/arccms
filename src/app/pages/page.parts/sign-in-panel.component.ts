import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { signIn } from 'virtual:arc-site';
import { renderSiteFragment } from './site-fragment';

/** The sign-in page's name and logo, from the site's identity (Settings, About). */
export interface SignInBrand {
    name: string;
    /** Empty when the page shows the name instead. */
    logo: string;
}

/** Arc CMS's own logo, for a site that has not named itself yet. */
export const ARC_CMS_LOGO = '/assets/images/logo.png';

/**
 * The site's own name and logo. A site with a name but no logo shows its name;
 * a site with neither shows Arc CMS's name and logo.
 */
export function signInBrand(identity: { name?: string; logoUrl?: string }, fallbackName: string): SignInBrand {
    const name = identity.name?.trim() || '';
    const logo = identity.logoUrl?.trim() || '';
    return { name: name || fallbackName, logo: logo || (name ? '' : ARC_CMS_LOGO) };
}

/**
 * The sign-in page's brand panel, beside the form on wide screens: the site's own
 * /_site/sign-in.html (src/custom/site/sign-in.html, else Arc CMS's neutral one),
 * plain HTML like the header, with `data-arc-t` text in the page's language.
 */
@Component({
    selector: 'arc-sign-in-panel',
    standalone: true,
    template: '',
    // Not scoped: the HTML is placed by code. Every rule starts with the element's
    // own name, so nothing reaches past the panel.
    styles: [`
        arc-sign-in-panel .auth-left-content {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            width: 80%;
            max-width: 500px;
        }
        arc-sign-in-panel .auth-left-title {
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 1.5rem;
        }
        arc-sign-in-panel .auth-left-description {
            font-size: 1.1rem;
            line-height: 1.6;
            opacity: 0.9;
        }
    `],
    encapsulation: ViewEncapsulation.None,
    host: { ngSkipHydration: 'true' },
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInPanelComponent {
    constructor() {
        renderSiteFragment(signIn, {});
    }
}
