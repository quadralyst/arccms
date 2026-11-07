import { Directive, HostListener } from '@angular/core';

/**
 * For HTML drawn into an admin page to be looked at (`[innerHTML]`), such as an email's live
 * preview: a click on a link in it stays on the page. Followed, it leaves an editor and its
 * unsaved work, and a link in an email can do something to whoever it was sent to (an
 * unsubscribe link). A preview in a frame gets the same from emailPreviewDocument()
 * (src/shared/utils/email-preview.ts).
 *
 *     <div arcPreviewLinks [innerHTML]="previewHtml()"></div>
 */
@Directive({
    selector: '[arcPreviewLinks]',
    standalone: true,
})
export class PreviewLinksDirective {
    /** A left click or Enter, and a middle click, which opens a tab. */
    @HostListener('click', ['$event'])
    @HostListener('auxclick', ['$event'])
    onClick(event: Event): void {
        // composedPath: a page's look may draw the HTML in a shadow root, which hides the link from event.target.
        const onLink = event.composedPath().some((node) => node instanceof Element && node.matches('a[href], area[href]'));
        if (onLink) event.preventDefault();
    }

    /** A form in a raw HTML block. */
    @HostListener('submit', ['$event'])
    onSubmit(event: Event): void {
        event.preventDefault();
    }
}
