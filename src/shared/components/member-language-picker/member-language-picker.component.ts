/**
 * Member language picker (docs/app/member-languages.html): English and the languages the
 * app declares in src/custom/languages.ts, each in its own name. Choosing one switches the
 * member screens at once and remembers it on this device.
 *
 * On the sign-in page; an app can put it on its own pages too. Renders nothing when the
 * app declares no member languages, as there is nothing to choose. Its button carries its
 * own styles and icon (inline SVG), so it also works inside a Shadow DOM host; the menu
 * opens in the page's overlay, outside the host, with the app's Material styles.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { TranslocoPipe } from '@jsverse/transloco';
import { MemberLanguageService } from '../../../app/core/i18n/member-language.service';

@Component({
    selector: 'arc-member-language-picker',
    standalone: true,
    imports: [MatMenuModule, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (languages.length > 1) {
        <button type="button" class="member-lang-btn" [matMenuTriggerFor]="menu" [attr.aria-label]="'member.language.choose' | transloco">
            <!-- A globe -->
            <svg class="member-lang-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>
            <span>{{ activeLabel() }}</span>
        </button>
        <mat-menu #menu="matMenu">
            @for (language of languages; track language.code) {
            <button mat-menu-item type="button" [attr.lang]="language.code" [class.is-active]="language.code === member.activeLang()" (click)="member.use(language.code)">
                <span>{{ language.label }}</span>
                @if (language.code === member.activeLang()) {
                <svg class="member-lang-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
                }
            </button>
            }
        </mat-menu>
        }
    `,
    styles: [`
        .member-lang-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            height: 36px;
            padding: 0 12px;
            border-radius: 8px;
            border: 1px solid #e0e0e0;
            background: #fff;
            color: #495057;
            font: inherit;
            font-size: 14px;
            cursor: pointer;
        }
        svg {
            width: 18px;
            height: 18px;
            fill: none;
            stroke: currentColor;
            stroke-width: 1.8;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        .member-lang-check { width: 16px; height: 16px; margin-left: 8px; vertical-align: -3px; }
        .member-lang-btn:hover { background: #f1f3f5; color: #1a1a1a; }
        .is-active { font-weight: 600; }
    `],
})
export class MemberLanguagePickerComponent {
    readonly member = inject(MemberLanguageService);
    readonly languages = this.member.languages;
    readonly activeLabel = computed(() => this.languages.find((l) => l.code === this.member.activeLang())?.label ?? '');
}
