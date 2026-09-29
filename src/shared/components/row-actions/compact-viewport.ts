import { DestroyRef, Signal, inject, signal } from '@angular/core';

/** Below this width the actions cell keeps one icon and moves the rest into the menu. */
export const COMPACT_VIEWPORT_QUERY = '(max-width: 767.98px)';

/** True while the window is phone-sized. Call from an injection context. */
export function injectCompactViewport(): Signal<boolean> {
    const media = typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia(COMPACT_VIEWPORT_QUERY)
        : null;
    const compact = signal(!!media?.matches);
    if (media) {
        const onChange = (e: MediaQueryListEvent) => compact.set(e.matches);
        media.addEventListener('change', onChange);
        inject(DestroyRef).onDestroy(() => media.removeEventListener('change', onChange));
    }
    return compact.asReadonly();
}
