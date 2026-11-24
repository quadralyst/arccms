import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { translocoTestingModule } from '../../../test/transloco-test-providers';
import { PwaService } from '../../../app/core/pwa/pwa.service';
import { PwaUpdateRouteService } from '../../../app/core/pwa/pwa-update-route';
import { PwaUpdateBarComponent } from './update-bar.component';

describe('PwaUpdateBarComponent', () => {
    const ready = signal(false);
    const closed = signal(false);
    const appOwns = signal(false);
    const pwa = { updateReady: ready, updateBarClosed: closed, applyUpdate: vi.fn(), dismissUpdate: vi.fn() };

    function render(): HTMLElement {
        TestBed.configureTestingModule({
            imports: [PwaUpdateBarComponent, translocoTestingModule()],
            providers: [
                { provide: PwaService, useValue: pwa },
                { provide: PwaUpdateRouteService, useValue: { appOwns } },
            ],
        });
        const fixture = TestBed.createComponent(PwaUpdateBarComponent);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    beforeEach(() => {
        TestBed.resetTestingModule();
        vi.clearAllMocks();
        ready.set(false);
        closed.set(false);
        appOwns.set(false);
    });

    it('shows nothing until a version is waiting', () => {
        expect(render().querySelector('.update-bar')).toBeNull();
    });

    it('offers the update, and applies it when the person taps Update', () => {
        ready.set(true);
        const el = render();
        const update = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Update')!;
        update.click();
        expect(pwa.applyUpdate).toHaveBeenCalled();
    });

    it('closes without applying', () => {
        ready.set(true);
        render().querySelector<HTMLButtonElement>('.btn-close')!.click();
        expect(pwa.dismissUpdate).toHaveBeenCalled();
        expect(pwa.applyUpdate).not.toHaveBeenCalled();
    });

    it('stays hidden after it was closed', () => {
        ready.set(true);
        closed.set(true);
        expect(render().querySelector('.update-bar')).toBeNull();
    });

    it('stays out of the way on a page where the app shows the update itself', () => {
        ready.set(true);
        appOwns.set(true);
        expect(render().querySelector('.update-bar')).toBeNull();
    });

    it('keeps its buttons together, so a narrow screen never leaves Close on a line of its own', () => {
        ready.set(true);
        const actions = render().querySelector('.update-bar > .update-bar-actions')!;
        expect([...actions.children].map((el) => el.tagName)).toEqual(['BUTTON', 'BUTTON']);
    });
});

describe('a bar at the bottom of the screen takes the room the screen has (F52)', () => {
    // No layout in jsdom: the rules the widths hang on, measured in Chrome and Safari when they were written.
    it.each([
        ['update-bar.component.ts', '.update-bar'],
        ['../../../app/core/version/stale-code-bar.component.ts', '.stale-bar'],
    ])('%s', (file, name) => {
        const source = readFileSync(resolve(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        const rule = (selector: string) => source.slice(source.indexOf(`${selector} {`)).split('}')[0];
        const bar = rule(name);
        // From left: 50% a box has half the screen, and its words break over lines it has room for.
        expect(bar).not.toMatch(/left:\s*50%|translateX/);
        // Both edges, clear of a notch, and as wide as its words, centred between them.
        expect(bar).toContain('left: max(1rem, env(safe-area-inset-left));');
        expect(bar).toContain('right: max(1rem, env(safe-area-inset-right));');
        expect(bar).toContain('bottom: max(1rem, env(safe-area-inset-bottom));');
        expect(bar).toContain('width: fit-content;');
        expect(bar).toContain('margin-inline: auto;');
        // The same padding by reading direction, and buttons under the words when they have too little left.
        expect(bar).toContain('padding-inline: 1rem 0.75rem;');
        expect(bar).toContain('flex-wrap: wrap;');
        expect(rule(`${name} > span`)).toContain('min-width: min(8em, 100%);');
    });
});
