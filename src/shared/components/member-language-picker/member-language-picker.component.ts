/**
 * Member language picker (docs/app/member-languages.html): English and the languages the
 * app declares in src/custom/languages.ts, each in its own name. Choosing one switches the
 * member screens at once and remembers it on this device.
 *
 * On the sign-in page; an app can put it on its own pages too. Renders nothing when the
 * app declares no member languages, as there is nothing to choose.
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
            <i class="fa-solid fa-language"></i>
            <span>{{ activeLabel() }}</span>
        </button>
        <mat-menu #menu="matMenu">
            @for (language of languages; track language.code) {
            <button mat-menu-item type="button" [attr.lang]="language.code" [class.is-active]="language.code === member.activeLang()" (click)="member.use(language.code)">
                <span>{{ language.label }}</span>
                @if (language.code === member.activeLang()) {
                <i class="fa-solid fa-check ms-2"></i>
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
            font-size: 14px;
            cursor: pointer;
        }
        .member-lang-btn:hover { background: #f1f3f5; color: #1a1a1a; }
        .is-active { font-weight: 600; }
    `],
})
export class MemberLanguagePickerComponent {
    readonly member = inject(MemberLanguageService);
    readonly languages = this.member.languages;
    readonly activeLabel = computed(() => this.languages.find((l) => l.code === this.member.activeLang())?.label ?? '');
}
