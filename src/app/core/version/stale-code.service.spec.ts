import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, PLATFORM_ID } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { isMissingCode, RETRY_WINDOW_MS, STALE_CODE_PAGE, StaleCodeService } from './stale-code.service';
import { StaleCodeBarComponent } from './stale-code-bar.component';
import { translocoTestingModule } from '../../../test/transloco-test-providers';

@Component({ template: '' })
class Page {}

const missing = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: http://x/assets/lessons.page-OLD.js'));

describe('StaleCodeService (specs/app-route-code-spec.md)', () => {
    let page: { assign: ReturnType<typeof vi.fn>; reload: ReturnType<typeof vi.fn>; read: (k: string) => string | null; write: (k: string, v: string) => void; now: () => number };
    let store: Map<string, string>;
    let clock: number;

    function setup(imports: unknown[] = []) {
        TestBed.configureTestingModule({
            imports: imports as never[],
            providers: [
                provideRouter([
                    { path: '', component: Page },
                    { path: 'kiosk', component: Page, data: { fullScreen: true, pwaUpdate: 'app' } },
                    { path: 'lessons', loadComponent: missing },
                    { path: 'broken', loadComponent: () => Promise.reject(new Error('Something else')) },
                ]),
                { provide: PLATFORM_ID, useValue: 'browser' },
                { provide: STALE_CODE_PAGE, useValue: page },
            ],
        });
        return { service: TestBed.inject(StaleCodeService), router: TestBed.inject(Router) };
    }

    beforeEach(() => {
        TestBed.resetTestingModule();
        store = new Map();
        clock = 1_000_000;
        page = { assign: vi.fn(), reload: vi.fn(), read: (k) => store.get(k) ?? null, write: (k, v) => void store.set(k, v), now: () => clock };
    });

    it('recognises a missing code file in Chrome, Safari and Firefox wording, and nothing else', () => {
        expect(isMissingCode(new TypeError('Failed to fetch dynamically imported module: x'))).toBe(true);
        expect(isMissingCode(new TypeError('Importing a module script failed.'))).toBe(true);
        expect(isMissingCode(new TypeError('error loading dynamically imported module: x'))).toBe(true);
        expect(isMissingCode(new Error('Cannot match any routes'))).toBe(false);
        expect(isMissingCode(undefined)).toBe(false);
    });

    it('on a normal page, loads the address the person asked for, fresh', async () => {
        const { service, router } = setup();
        await router.navigateByUrl('/');
        await router.navigateByUrl('/lessons').catch(() => undefined);
        expect(page.assign).toHaveBeenCalledWith('/lessons');
        expect(service.stale()).toBe(true);
        expect(service.needsReload()).toBe(false);
    });

    it('does not loop: a second failure soon after shows the message instead', async () => {
        const { service, router } = setup();
        await router.navigateByUrl('/');
        await router.navigateByUrl('/lessons').catch(() => undefined);
        clock += RETRY_WINDOW_MS - 1;
        await router.navigateByUrl('/lessons').catch(() => undefined);
        expect(page.assign).toHaveBeenCalledTimes(1);
        expect(service.needsReload()).toBe(true);
        // Much later, it tries a fresh load again.
        clock += RETRY_WINDOW_MS * 10;
        await router.navigateByUrl('/lessons').catch(() => undefined);
        expect(page.assign).toHaveBeenCalledTimes(2);
    });

    it('never reloads on a page where the app shows updates itself; stale() tells the app', async () => {
        const { service, router } = setup();
        await router.navigateByUrl('/kiosk');
        await router.navigateByUrl('/lessons').catch(() => undefined);
        expect(page.assign).not.toHaveBeenCalled();
        expect(page.reload).not.toHaveBeenCalled();
        expect(service.stale()).toBe(true);
        service.reload();
        expect(page.reload).toHaveBeenCalledTimes(1);
    });

    it('leaves other navigation errors alone', async () => {
        const { service, router } = setup();
        await router.navigateByUrl('/broken').catch(() => undefined);
        expect(page.assign).not.toHaveBeenCalled();
        expect(service.stale()).toBe(false);
    });

    it('shows the message with a Reload button only when a fresh load did not help', async () => {
        const { router } = setup([StaleCodeBarComponent, translocoTestingModule()]);
        const fixture = TestBed.createComponent(StaleCodeBarComponent);
        fixture.detectChanges();
        expect((fixture.nativeElement as HTMLElement).querySelector('.stale-bar')).toBeNull();
        await router.navigateByUrl('/lessons').catch(() => undefined);
        await router.navigateByUrl('/lessons').catch(() => undefined);
        fixture.detectChanges();
        const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
        expect(button.textContent?.trim()).toBe('Reload');
        button.click();
        expect(page.reload).toHaveBeenCalled();
    });
});
