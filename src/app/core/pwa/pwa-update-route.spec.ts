import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { ActivatedRouteSnapshot, Router, provideRouter } from '@angular/router';
import { PwaUpdateRouteService, routeOwnsPwaUpdate } from './pwa-update-route';

function snapshot(...levels: Array<Record<string, unknown>>): ActivatedRouteSnapshot {
    let child: ActivatedRouteSnapshot | null = null;
    for (const data of [...levels].reverse()) {
        const node = { data, firstChild: child } as unknown as ActivatedRouteSnapshot;
        child = node;
    }
    return child!;
}

describe('routeOwnsPwaUpdate', () => {
    it('is false for a normal page', () => {
        expect(routeOwnsPwaUpdate(null)).toBe(false);
        expect(routeOwnsPwaUpdate(snapshot({}, { title: 'Home' }))).toBe(false);
    });

    it('is true when the page, or any route above it, says pwaUpdate: "app"', () => {
        expect(routeOwnsPwaUpdate(snapshot({}, { pwaUpdate: 'app' }))).toBe(true);
        expect(routeOwnsPwaUpdate(snapshot({ pwaUpdate: 'app' }, {}, {}))).toBe(true);
    });

    it('ignores any other value, so a later one can be added without a break', () => {
        expect(routeOwnsPwaUpdate(snapshot({ pwaUpdate: 'arc' }))).toBe(false);
        expect(routeOwnsPwaUpdate(snapshot({ pwaUpdate: true }))).toBe(false);
    });
});

@Component({ template: '' })
class Page {}

describe('PwaUpdateRouteService', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideRouter([
                { path: '', component: Page },
                { path: 'till', component: Page, data: { fullScreen: true, pwaUpdate: 'app' } },
                { path: 'plain', component: Page, data: { fullScreen: true } },
                { path: 'owned', data: { pwaUpdate: 'app' }, children: [{ path: 'child', component: Page }] },
            ])],
        });
    });

    it('follows the page the person is on', async () => {
        const router = TestBed.inject(Router);
        const service = TestBed.inject(PwaUpdateRouteService);
        expect(service.appOwns()).toBe(false);

        await router.navigateByUrl('/till');
        expect(service.appOwns()).toBe(true);
        await router.navigateByUrl('/');
        expect(service.appOwns()).toBe(false);
        await router.navigateByUrl('/plain');
        expect(service.appOwns()).toBe(false);
        await router.navigateByUrl('/owned/child');
        expect(service.appOwns()).toBe(true);
    });
});
