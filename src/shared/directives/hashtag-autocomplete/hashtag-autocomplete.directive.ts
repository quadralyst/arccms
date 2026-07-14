import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import {
    ComponentRef,
    Directive,
    ElementRef,
    HostListener,
    inject,
    Input,
    OnDestroy,
    ViewContainerRef,
} from '@angular/core';
import {
    filterEmailTags,
    findActiveHashToken,
    HashToken,
    replaceHashToken,
} from '../../constants/email-tags';
import { TagSuggestionListComponent } from './tag-suggestion-list.component';

/**
 * Adds `#`-triggered merge-tag autocomplete to a plain `<input>`/`<textarea>`.
 *
 * Typing `#` (anywhere, mid-word included) opens a CDK-overlay list of the
 * available `##TAG##` tokens. Selecting one replaces the typed `#query` with the
 * full `##TAG##` token. Mirrors the TipTap body behaviour for subject/preview
 * lines and other plain compose inputs.
 *
 * Usage: `<input [arcHashtagAutocomplete]="tagsArray">`
 */
@Directive({
    selector: '[arcHashtagAutocomplete]',
    standalone: true,
})
export class HashtagAutocompleteDirective implements OnDestroy {
    /** Available merge tags for this input (`['##NAME##', ...]`). */
    @Input('arcHashtagAutocomplete') tags: string[] = [];

    private readonly el = inject<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(ElementRef);
    private readonly overlay = inject(Overlay);
    private readonly vcr = inject(ViewContainerRef);

    private overlayRef: OverlayRef | null = null;
    private listRef: ComponentRef<TagSuggestionListComponent> | null = null;
    private token: HashToken | null = null;
    private items: string[] = [];
    private activeIndex = 0;

    @HostListener('input')
    onInput(): void {
        this.sync();
    }

    @HostListener('click')
    onClick(): void {
        this.sync();
    }

    @HostListener('keyup', ['$event'])
    onKeyup(event: KeyboardEvent): void {
        // Re-evaluate the token when the caret moves without changing text.
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            this.sync();
        }
    }

    @HostListener('keydown', ['$event'])
    onKeydown(event: KeyboardEvent): void {
        if (!this.isOpen) return;

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                this.move(1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                this.move(-1);
                break;
            case 'Enter':
            case 'Tab':
                if (this.items.length) {
                    event.preventDefault();
                    this.pick(this.items[this.activeIndex]);
                }
                break;
            case 'Escape':
                event.preventDefault();
                this.close();
                break;
        }
    }

    @HostListener('blur')
    onBlur(): void {
        // Defer so a mousedown selection on the list resolves before we tear down.
        setTimeout(() => this.close(), 120);
    }

    ngOnDestroy(): void {
        this.close();
    }

    private get isOpen(): boolean {
        return this.overlayRef !== null;
    }

    private sync(): void {
        const input = this.el.nativeElement;
        const caret = input.selectionStart ?? input.value.length;
        const token = findActiveHashToken(input.value, caret);
        if (!token) {
            this.close();
            return;
        }

        const items = filterEmailTags(this.tags ?? [], token.query);
        if (items.length === 0) {
            this.close();
            return;
        }

        this.token = token;
        this.items = items;
        this.activeIndex = 0;
        this.open();
    }

    private open(): void {
        if (!this.overlayRef) {
            const positionStrategy = this.overlay
                .position()
                .flexibleConnectedTo(this.el)
                .withPositions([
                    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
                    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
                ]);

            this.overlayRef = this.overlay.create({
                positionStrategy,
                scrollStrategy: this.overlay.scrollStrategies.reposition(),
            });

            this.listRef = this.overlayRef.attach(new ComponentPortal(TagSuggestionListComponent, this.vcr));
            this.listRef.instance.pick.subscribe((tag: string) => this.pick(tag));
            this.listRef.instance.hover.subscribe((index: number) => {
                this.activeIndex = index;
                this.renderList();
            });
        }
        this.renderList();
    }

    private renderList(): void {
        if (!this.listRef) return;
        this.listRef.instance.items = this.items;
        this.listRef.instance.activeIndex = this.activeIndex;
        this.listRef.changeDetectorRef.detectChanges();
    }

    private move(delta: number): void {
        if (!this.items.length) return;
        this.activeIndex = (this.activeIndex + delta + this.items.length) % this.items.length;
        this.renderList();
    }

    private pick(tag: string): void {
        if (!tag || !this.token) return;

        const input = this.el.nativeElement;
        const caret = input.selectionStart ?? input.value.length;
        const { value, caret: nextCaret } = replaceHashToken(input.value, caret, this.token.hashIndex, tag);

        input.value = value;
        input.setSelectionRange(nextCaret, nextCaret);
        // Notify Angular forms (ReactiveForms / ngModel both listen to 'input').
        input.dispatchEvent(new Event('input', { bubbles: true }));

        this.close();
        input.focus();
    }

    private close(): void {
        if (this.overlayRef) {
            this.overlayRef.dispose();
            this.overlayRef = null;
            this.listRef = null;
        }
        this.token = null;
        this.items = [];
        this.activeIndex = 0;
    }
}
