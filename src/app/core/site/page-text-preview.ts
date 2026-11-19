import { InjectionToken } from '@angular/core';
import type { PageTextValues } from '../utils/page-text-model';

/**
 * Live Preview of a page's text (specs/visual-editing-spec.md, VE-D50): provided
 * by the preview window, it gives the home page and static page renderers the
 * draft's values to fill instead of the published ones. A page drawn with it is
 * a preview: it names itself to no admin strip and sends nobody to the setup wizard.
 */
export interface PageTextPreview {
    /** The draft's values as they are now. */
    values(): PageTextValues | null;
    /**
     * The Visual Editor's frame (VE-D55): the marks stay on the page, so the screen
     * finds the areas, the page's own scripts do not run, and `<html>` carries
     * `arc-editing`, for a developer to show what a script would reveal.
     */
    readonly editing?: boolean;
}

export const PAGE_TEXT_PREVIEW = new InjectionToken<PageTextPreview>('PAGE_TEXT_PREVIEW');
