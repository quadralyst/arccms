import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NO_LIVE_SITE_FILES, SiteDriftService } from '../../../../core/site/site-drift';

/** Where the compact notice's message opens: fixed, under the button, kept on screen. */
interface PopoverPlace {
    top: number;
    left: number;
    width: number;
}

/**
 * Says, beside Publish, when the site files on this computer differ from the live
 * site's, which publishing uses (src/app/core/site/site-drift.ts). Shows nothing
 * when they match and outside `npm run dev`. `compact` fits a toolbar: a short
 * label (only the icon on a phone), with the full message and the files on hover,
 * and on a click or tap.
 */
@Component({
    selector: 'arc-site-drift-notice',
    standalone: true,
    imports: [TranslocoPipe],
    template: `
        @if (files().length) {
            @if (compact()) {
                <button #toggle type="button" class="site-drift-notice compact" [title]="(message() | transloco) + ' ' + ('admin.contents.site_drift.files' | transloco: { files: files().join(', ') })"
                    [attr.aria-label]="'admin.contents.site_drift.label' | transloco"
                    [attr.aria-expanded]="!!popover()" (click)="togglePopover(toggle)">
                    <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                    <span class="site-drift-label">{{ 'admin.contents.site_drift.label' | transloco }}</span>
                </button>
                @if (popover(); as place) {
                    <span class="site-drift-popover" role="status"
                        [style.top.px]="place.top" [style.left.px]="place.left" [style.width.px]="place.width">
                        <strong>{{ 'admin.contents.site_drift.label' | transloco }}</strong>
                        <span>{{ message() | transloco }}</span>
                    </span>
                }
            } @else {
                <span class="site-drift-notice" role="status" [title]="(message() | transloco) + ' ' + ('admin.contents.site_drift.files' | transloco: { files: files().join(', ') })">
                    <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                    <span>{{ message() | transloco }}</span>
                </span>
            }
        }
    `,
    styles: [`
        :host { display: contents; }
        .site-drift-notice {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.35rem 0.75rem;
            border-radius: 6px;
            background: #fff8e1;
            color: #8a5a00;
            font-size: 0.85rem;
            line-height: 1.3;
        }
        .site-drift-notice:not(.compact) { margin-bottom: 1rem; }
        .site-drift-notice.compact {
            margin-right: 0.5rem;
            white-space: nowrap;
            cursor: pointer;
            border: 0;
            font: inherit;
            font-size: 0.85rem;
        }
        .site-drift-popover {
            position: fixed;
            z-index: 1000;
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
            padding: 0.6rem 0.75rem;
            border: 1px solid #f0d58a;
            border-radius: 8px;
            background: #fff8e1;
            color: #6b4600;
            font-size: 0.85rem;
            line-height: 1.35;
            white-space: normal;
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.15);
        }
        /* A phone: the editor's toolbar buttons are icons in 44px squares, and so is this. */
        @media (max-width: 576px) {
            .site-drift-notice.compact {
                justify-content: center;
                min-width: 44px;
                height: 44px;
                padding: 0 0.5rem;
                margin-right: 0;
                flex: 1;
                font-size: 1.1rem;
            }
            .site-drift-label { display: none; }
        }
    `],
})
export class SiteDriftNoticeComponent implements OnInit, OnDestroy {
    /** A short label for a toolbar instead of the whole message. */
    compact = input(false);

    /** The served paths that differ from the live site. */
    files = signal<string[]>([]);

    /** Where the compact notice's message is open, or null when it is closed. */
    popover = signal<PopoverPlace | null>(null);

    private drift = inject(SiteDriftService);
    private host = inject<ElementRef<HTMLElement>>(ElementRef);

    message = computed(() => (this.files().length === 1 && this.files()[0] === NO_LIVE_SITE_FILES
        ? 'admin.contents.site_drift.missing'
        : 'admin.contents.site_drift.message'));

    async ngOnInit(): Promise<void> {
        this.files.set(await this.drift.differences());
    }

    togglePopover(button: HTMLElement): void {
        if (this.popover()) {
            this.popover.set(null);
            return;
        }
        const rect = button.getBoundingClientRect();
        const margin = 16;
        const width = Math.min(288, window.innerWidth - margin * 2);
        // Right-aligned with the button, as it sits at the toolbar's right, but never off screen.
        const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - margin - width);
        this.popover.set({ top: rect.bottom + 6, left, width });
        // The message is placed for where the button is now. The admin scrolls inside
        // its own panels, not the window, so listen to every scroll.
        document.addEventListener('scroll', this.closeOnScroll, { capture: true, once: true });
    }

    private closeOnScroll = (): void => this.close();

    ngOnDestroy(): void {
        document.removeEventListener('scroll', this.closeOnScroll, { capture: true });
    }

    /** A tap anywhere else closes the message. */
    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent): void {
        if (!this.popover()) return;
        const button = this.host.nativeElement.querySelector('.site-drift-notice');
        if (button && event.target instanceof Node && button.contains(event.target)) return;
        this.popover.set(null);
    }

    /** Escape closes the message, and so does a resize, which moves the button. */
    @HostListener('document:keydown.escape')
    @HostListener('window:resize')
    close(): void {
        if (this.popover()) this.popover.set(null);
    }
}
