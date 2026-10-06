/**
 * Admin UI language picker.
 *
 * Sits in the page header beside the notification bell, so it is reachable
 * from every admin page rather than buried in a settings form — a person who
 * has landed in a language they cannot read needs it *there*, not three
 * navigations away.
 *
 * Renders nothing when only one admin language ships, the same way the public
 * switcher does on a single-language site, and nothing outside the admin area when the
 * app declares member languages: there the page is in the member's language, which the
 * admin's choice does not change (docs/app/member-languages.html).
 *
 * Spec: specs/multilingual-spec.md — Phase M6.
 */

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslocoPipe } from '@jsverse/transloco';
import { AdminLanguageService } from '../../../app/core/i18n/admin-language.service';
import { LanguageAreaService, MEMBER_LANGUAGES_DECLARED } from '../../../app/core/i18n/member-language.service';

@Component({
    selector: 'arc-admin-language-picker',
    standalone: true,
    imports: [MatMenuModule, MatTooltipModule, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (shown() && languages.length > 1) {
        <button
            type="button"
            class="lang-btn"
            [matMenuTriggerFor]="menu"
            [matTooltip]="'common.language.admin_ui' | transloco"
            [attr.aria-label]="'common.language.admin_ui' | transloco"
        >
            <i class="fa-solid fa-language"></i>
            <span class="code">{{ i18n.activeLang() }}</span>
        </button>

        <mat-menu #menu="matMenu">
            @for (language of languages; track language.code) {
            <button
                mat-menu-item
                type="button"
                [class.is-active]="language.code === i18n.activeLang()"
                (click)="i18n.use(language.code)"
            >
                <span>{{ language.label }}</span>
                @if (language.code === i18n.activeLang()) {
                <i class="fa-solid fa-check ms-2"></i>
                }
            </button>
            }
        </mat-menu>
        }
    `,
    styles: [`
        .lang-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            height: 36px;
            padding: 0 10px;
            border-radius: 8px;
            border: 1px solid #e0e0e0;
            background: #fff;
            color: #495057;
            cursor: pointer;
            transition: all 0.2s;
        }
        .lang-btn:hover { background: #f1f3f5; color: #1a1a1a; }
        .lang-btn .code { font-size: 13px; text-transform: uppercase; font-weight: 600; }
        .is-active { font-weight: 600; }
    `],
})
export class AdminLanguagePickerComponent {
    readonly i18n = inject(AdminLanguageService);
    readonly languages = this.i18n.languages;
    private readonly area = inject(LanguageAreaService);
    readonly shown = computed(() => !MEMBER_LANGUAGES_DECLARED || this.area.inAdmin());
}
