/**
 * The member's language (specs/app-member-language-spec.md, L-D3 to L-D7,
 * docs/app/member-languages.html).
 *
 * Members see English plus the languages the app declares in src/custom/languages.ts;
 * the admin keeps its own (AdminLanguageService). The choice is kept on this device, so a
 * shared device shows it on the sign-in screen too. On a first visit the browser's
 * language is used if the app has it, else English.
 *
 * With no languages declared none of this runs: the member area follows the admin
 * language exactly as before (L-D2).
 */
import { Injectable, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { filter } from 'rxjs';
import { MEMBER_LANGUAGES } from '../../../custom/languages';
import { AdminLanguageService } from './admin-language.service';
import {
    DEFAULT_MEMBER_LANGUAGE, MEMBER_LANGUAGE_CACHE_KEY, chooseMemberLanguage, isAdminUrl, resolveMemberLanguages,
    type MemberLanguage,
} from './member-languages';

/** English plus the app's languages. Resolved once: a mistake stops the app with the message. */
export const MEMBER_LANGUAGE_LIST: readonly MemberLanguage[] = resolveMemberLanguages(MEMBER_LANGUAGES);
/** Whether the app declared member languages at all. */
export const MEMBER_LANGUAGES_DECLARED = MEMBER_LANGUAGES.length > 0;

function readSaved(): string | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage.getItem(MEMBER_LANGUAGE_CACHE_KEY);
    } catch {
        return null;
    }
}

function browserLanguages(): readonly string[] {
    return typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language].filter(Boolean));
}

/** The member language this device starts in, before anything is injected (for LOCALE_ID). */
export function startingMemberLanguage(list: readonly MemberLanguage[] = MEMBER_LANGUAGE_LIST): MemberLanguage {
    const code = chooseMemberLanguage(readSaved(), browserLanguages(), list.map((l) => l.code));
    return list.find((l) => l.code === code) ?? list[0];
}

let instance: MemberLanguageService | null = null;

/**
 * Set the member language from anywhere in the app (docs/app/member-languages.html):
 * `setMemberLanguage('de')`. Remembered on this device. Text changes at once; dates and
 * numbers on the next load, or now with `{ reload: true }`.
 */
export function setMemberLanguage(code: string, options: { reload?: boolean } = {}): void {
    if (!instance) throw new Error('setMemberLanguage: the app has not started yet.');
    instance.use(code, options);
}

@Injectable({ providedIn: 'root' })
export class MemberLanguageService {
    private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

    readonly languages = MEMBER_LANGUAGE_LIST;
    private readonly lang = signal(this.browser ? startingMemberLanguage().code : DEFAULT_MEMBER_LANGUAGE);
    /** The language member screens show now. */
    readonly activeLang = this.lang.asReadonly();
    /**
     * Its locale, for dates and numbers that should follow a change at once:
     * `{{ when | date: 'mediumDate' : undefined : member.activeLocale() }}`.
     */
    readonly activeLocale = computed(() => this.languages.find((l) => l.code === this.lang())?.locale ?? 'en-US');

    constructor() {
        instance = this;
    }

    /** Switch member screens to a language the app has, and remember it on this device. */
    use(code: string, options: { reload?: boolean } = {}): void {
        if (!this.languages.some((l) => l.code === code)) return;
        this.lang.set(code);
        if (!this.browser) return;
        try {
            localStorage.setItem(MEMBER_LANGUAGE_CACHE_KEY, code);
        } catch {
            // private mode: the choice lasts this visit only
        }
        if (options.reload) location.reload();
    }
}

/**
 * Applies the right language to the page (L-D3): the admin's under /admin, the member's
 * elsewhere. Started when the app starts; does nothing when the app declares no member
 * languages.
 */
@Injectable({ providedIn: 'root' })
export class LanguageAreaService {
    private readonly router = inject(Router);
    private readonly transloco = inject(TranslocoService);
    private readonly admin = inject(AdminLanguageService);
    private readonly member = inject(MemberLanguageService);

    private readonly url = signal(typeof location === 'undefined' ? '/' : location.pathname);
    /** True while the page is in the admin area. */
    readonly inAdmin = computed(() => isAdminUrl(this.url()));

    constructor() {
        if (!MEMBER_LANGUAGES_DECLARED) return;
        this.router.events
            .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
            .subscribe((e) => this.url.set(e.urlAfterRedirects));
        effect(() => {
            const lang = this.inAdmin() ? this.admin.activeLang() : this.member.activeLang();
            untracked(() => this.transloco.setActiveLang(lang));
        });
    }
}
