import { describe, it, expect, beforeEach } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { FullScreenService, routeIsFullScreen } from './full-screen.service';

@Component({ template: '' })
class Blank {}

describe('routeIsFullScreen', () => {
    const route = (data: object, firstChild: unknown = null) => ({ data, firstChild }) as any;

    it('is true when a route on the way to the page says fullScreen: true', () => {
        expect(routeIsFullScreen(route({}, route({ fullScreen: true }, route({}))))).toBe(true);
    });

    it('is false without the option', () => {
        expect(routeIsFullScreen(route({}, route({})))).toBe(false);
        expect(routeIsFullScreen(null)).toBe(false);
    });

    it('lets the deepest route that sets it decide', () => {
        expect(routeIsFullScreen(route({ fullScreen: true }, route({ fullScreen: false })))).toBe(false);
    });
});

describe('FullScreenService', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideRouter([
                { path: 'game', component: Blank, data: { fullScreen: true } },
                { path: 'player', data: { fullScreen: true }, children: [{ path: 'notes', component: Blank, data: { fullScreen: false } }, { path: '', component: Blank }] },
                { path: '', component: Blank },
            ])],
        });
    });

    it('follows the page as the person moves around', async () => {
        const router = TestBed.inject(Router);
        const service = TestBed.inject(FullScreenService);
        await router.navigateByUrl('/');
        expect(service.active()).toBe(false);
        await router.navigateByUrl('/game');
        expect(service.active()).toBe(true);
        await router.navigateByUrl('/player');
        expect(service.active()).toBe(true);
        await router.navigateByUrl('/player/notes');
        expect(service.active()).toBe(false);
        await router.navigateByUrl('/');
        expect(service.active()).toBe(false);
    });

    it('knows the page it starts on', async () => {
        await TestBed.inject(Router).navigateByUrl('/game');
        expect(TestBed.inject(FullScreenService).active()).toBe(true);
    });
});
