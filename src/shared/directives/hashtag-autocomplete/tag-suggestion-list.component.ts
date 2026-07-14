import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Popup list rendered inside a CDK overlay by {@link HashtagAutocompleteDirective}.
 * Purely presentational: it shows the filtered tags and emits the picked one.
 */
@Component({
    selector: 'arc-tag-suggestion-list',
    standalone: true,
    imports: [CommonModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="arc-tag-suggestions" role="listbox">
            @if (items.length === 0) {
                <div class="arc-tag-suggestions__empty">No matching tags</div>
            } @else {
                @for (item of items; track item; let i = $index) {
                    <button
                        type="button"
                        role="option"
                        class="arc-tag-suggestions__item"
                        [class.is-active]="i === activeIndex"
                        [attr.aria-selected]="i === activeIndex"
                        (mouseenter)="hover.emit(i)"
                        (mousedown)="onPick($event, item)"
                    >
                        {{ item }}
                    </button>
                }
            }
        </div>
    `,
    styles: [
        `
        .arc-tag-suggestions {
            min-width: 200px;
            max-height: 260px;
            overflow-y: auto;
            padding: 4px;
            background: var(--arc-surface, #fff);
            border: 1px solid var(--arc-border, #e2e5ea);
            border-radius: 10px;
            box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14);
            font-family: inherit;
        }
        .arc-tag-suggestions__item {
            display: block;
            width: 100%;
            text-align: left;
            padding: 8px 10px;
            border: none;
            background: transparent;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-family: 'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace;
            color: var(--arc-text, #1f2430);
        }
        .arc-tag-suggestions__item.is-active,
        .arc-tag-suggestions__item:hover {
            background: var(--arc-accent-soft, #eef2ff);
        }
        .arc-tag-suggestions__empty {
            padding: 10px 12px;
            font-size: 13px;
            color: var(--arc-text-muted, #8a90a2);
        }
        `,
    ],
})
export class TagSuggestionListComponent {
    @Input() items: string[] = [];
    @Input() activeIndex = 0;

    /** Emits the chosen tag string. */
    @Output() pick = new EventEmitter<string>();
    /** Emits the hovered index so the directive keeps keyboard/mouse in sync. */
    @Output() hover = new EventEmitter<number>();

    onPick(event: MouseEvent, item: string): void {
        // Prevent the mousedown from blurring the input before we insert.
        event.preventDefault();
        this.pick.emit(item);
    }
}
