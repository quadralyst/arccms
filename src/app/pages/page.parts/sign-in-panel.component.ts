import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject } from '@angular/core';
import { signIn } from 'virtual:arc-site';
import { renderSiteFragment } from './site-fragment';
import { DEFAULT_MEMBER_LANGUAGE } from '../../core/i18n/member-languages';
import { MEMBER_LANGUAGES_DECLARED, MemberLanguageService } from '../../core/i18n/member-language.service';

/**
 * The sign-in page's brand panel, beside the form on wide screens: the site's own
 * /_site/sign-in.html (src/custom/site/sign-in.html, else Arc CMS's neutral one),
 * plain HTML like the header, with `data-arc-t` text in the page's language, or in the
 * language a member chose when the app declares member languages.
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
        // With member languages, the panel speaks the language chosen on the page
        // (the site's strings file for it); without, the page's language as before.
        const member = inject(MemberLanguageService);
        renderSiteFragment(signIn, {}, MEMBER_LANGUAGES_DECLARED ? { language: () => panelLanguage(member.activeLang()) } : {});
    }
}

/** The site strings language for a member language: none for English, the text as written. */
export function panelLanguage(memberLanguage: string): string {
    return memberLanguage === DEFAULT_MEMBER_LANGUAGE ? '' : memberLanguage;
}
