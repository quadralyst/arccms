/**
 * The `screen_view` event AngularFire's ScreenTrackingService sends, rebuilt for the
 * `required` consent mode, where that service is not loaded (docs/features/analytics.html).
 * The parameter names are AngularFire's own, so reports read the same in both modes;
 * a test compares them with AngularFire's source.
 */
import { reflectComponentType, type Type } from '@angular/core';
import type { ActivatedRouteSnapshot } from '@angular/router';

export const SCREEN_VIEW_EVENT = 'screen_view';

export type ScreenViewParams = Record<string, string | number>;

/** One screen: the route path pattern, the component's selector and the address it is at. */
export function screenOf(root: ActivatedRouteSnapshot, pagePath: string, title: string): ScreenViewParams {
    let deepest = root;
    while (deepest.firstChild) deepest = deepest.firstChild;
    const screenName = deepest.pathFromRoot.map((s) => s.routeConfig?.path).filter((p) => p).join('/') || '/';
    const component = deepest.component as Type<unknown> | null | undefined;
    const screenClass = component ? (reflectComponentType(component)?.selector ?? component.name) : '';
    return {
        screen_name: screenName,
        page_path: pagePath,
        firebase_event_origin: 'auto',
        firebase_screen: screenName,
        outlet: 'primary',
        page_title: title,
        screen_class: screenClass,
        firebase_screen_class: screenClass,
    };
}

/**
 * Numbers each screen and adds the previous one, as AngularFire does. Returns null when
 * the screen is the same as the last one (a repeated activation), so it is not sent twice.
 */
export class ScreenViewSequence {
    private ids = new Map<string, number>();
    private nextId = 1;
    private prior: ScreenViewParams | null = null;

    next(screen: ScreenViewParams): ScreenViewParams | null {
        const key = `${screen['screen_class']}#${screen['outlet']}`;
        if (!this.ids.has(key)) this.ids.set(key, this.nextId++);
        const current: ScreenViewParams = { ...screen, firebase_screen_id: this.ids.get(key)! };
        if (this.prior && JSON.stringify(withoutPrevious(this.prior)) === JSON.stringify(current)) return null;
        const params: ScreenViewParams = this.prior
            ? {
                firebase_previous_class: this.prior['screen_class'],
                firebase_previous_screen: this.prior['screen_name'],
                firebase_previous_id: this.prior['firebase_screen_id'],
                ...current,
            }
            : current;
        this.prior = current;
        return params;
    }
}

function withoutPrevious(params: ScreenViewParams): ScreenViewParams {
    const { firebase_previous_class: _c, firebase_previous_screen: _s, firebase_previous_id: _i, ...rest } = params;
    return rest;
}
