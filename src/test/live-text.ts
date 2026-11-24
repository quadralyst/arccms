import { signal } from '@angular/core';
import { said, type LiveText, type Say } from '../app/core/i18n/live-text';

/**
 * A live text (core/i18n/live-text.ts) for specs that call a component's methods on a
 * stand-in `this`: read it as `text()`. The real one, which follows the page's
 * language, needs Angular.
 */
export function standInText(): LiveText {
    const source = signal<Say>('');
    return Object.assign(() => said(source()), { set: (say: Say) => source.set(say), source: () => source() });
}
