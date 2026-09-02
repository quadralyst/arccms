import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { NotificationBellComponent } from '../notification-bell/notification-bell.component';
import { AdminLanguagePickerComponent } from '../admin-language-picker/admin-language-picker.component';

/**
 * Unified page header used across the admin AND signed-in user areas.
 *
 * One row: title (+ optional subtitle) on the left, projected page actions and
 * the notification bell on the right. Carries its own styles (not the global
 * `.arc-admin .page-header` rules) so it renders identically inside the admin
 * shell and the user shell. Deliberately NOT sticky — it scrolls away with the
 * page so content gets maximum vertical space.
 *
 * Usage:
 *   <arc-page-header title="Contacts" subtitle="The unified audience.">
 *     <button mat-flat-button color="primary">Add</button>
 *   </arc-page-header>
 */
@Component({
    selector: 'arc-page-header',
    standalone: true,
    imports: [NotificationBellComponent, AdminLanguagePickerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <header class="arc-page-header">
            <div class="lead">
                @if (showBack) {
                <button type="button" class="back-btn" (click)="back.emit()" aria-label="Back">
                    <i class="fas fa-arrow-left"></i>
                </button>
                }
                <div class="titles">
                    <h1>{{ title }}</h1>
                    @if (subtitle) { <p class="subtitle">{{ subtitle }}</p> }
                </div>
            </div>
            <div class="actions">
                <ng-content></ng-content>
                @if (showLanguagePicker) {
                <arc-admin-language-picker></arc-admin-language-picker>
                }
                @if (showBell) {
                <span class="bell-slot"><arc-notification-bell></arc-notification-bell></span>
                }
            </div>
        </header>
    `,
    styles: [`
        .arc-page-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 1rem;
            margin-bottom: 24px;
        }
        .lead { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .back-btn {
            flex-shrink: 0;
            width: 36px;
            height: 36px;
            border-radius: 8px;
            border: 1px solid #e0e0e0;
            background: #fff;
            color: #495057;
            cursor: pointer;
            transition: all 0.2s;
        }
        .back-btn:hover { background: #f1f3f5; color: #1a1a1a; }
        .titles { min-width: 0; }
        .titles h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 600;
            color: #1a1a1a;
            line-height: 1.2;
        }
        .subtitle {
            margin: 4px 0 0;
            color: #666;
            font-size: 14px;
        }
        .actions {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
            flex-wrap: wrap;
            justify-content: flex-end;
        }
        /* Separate the persistent bell from page-specific actions. */
        .bell-slot {
            display: inline-flex;
            align-items: center;
            margin-left: 4px;
            padding-left: 8px;
            border-left: 1px solid #e9ecef;
        }
        .actions:only-child .bell-slot,
        .bell-slot:only-child {
            border-left: none;
            padding-left: 0;
            margin-left: 0;
        }
        @media (max-width: 768px) {
            .arc-page-header {
                flex-direction: column;
                align-items: stretch;
                gap: 0.75rem;
            }
            .actions { justify-content: flex-start; }
        }
    `],
})
export class PageHeaderComponent {
    @Input() title = '';
    @Input() subtitle?: string;
    /** Bell shows by default; set false for contexts without notifications (e.g. onboarding). */
    @Input() showBell = true;
    /**
     * The admin UI language picker, shown by default so someone who has landed
     * in a language they cannot read can get out of it from wherever they are.
     * Turn it off alongside the bell in contexts with no signed-in admin.
     */
    @Input() showLanguagePicker = true;
    /** Show an inline back button before the title (for detail/sub pages). */
    @Input() showBack = false;
    @Output() back = new EventEmitter<void>();
}
