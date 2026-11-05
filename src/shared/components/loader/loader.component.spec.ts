import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LoaderComponent } from './loader.component';

@Component({ standalone: true, imports: [LoaderComponent], template: `<arc-loader kind="rows" [count]="4" label="Loading orders"></arc-loader><arc-loader></arc-loader>` })
class Host {}

describe('the shared loader', () => {
    function render() {
        TestBed.configureTestingModule({ imports: [Host] });
        const fixture = TestBed.createComponent(Host);
        fixture.detectChanges();
        return [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.arc-loader')];
    }

    it('has a name a screen reader says, and hides its bars from it', () => {
        const [named, plain] = render();
        expect(named.getAttribute('role')).toBe('status');
        expect(named.querySelector('.arc-loader-name')?.textContent).toBe('Loading orders');
        expect(plain.querySelector('.arc-loader-name')?.textContent).toBe('Loading...');
        expect([...named.querySelectorAll('.arc-loader-bar')].every((bar) => bar.getAttribute('aria-hidden') === 'true')).toBe(true);
    });

    it('draws as many bars as asked for, in the shape of what is coming', () => {
        const [named, plain] = render();
        expect(named.classList.contains('arc-loader-rows')).toBe(true);
        expect(named.querySelectorAll('.arc-loader-bar')).toHaveLength(4);
        expect(plain.classList.contains('arc-loader-lines')).toBe(true);
    });

    it('stops moving for someone who asks for less motion', () => {
        const source = readFileSync(resolve(__dirname, 'loader.component.ts'), 'utf8');
        expect(source).toMatch(/prefers-reduced-motion: reduce\)[^}]*animation: none/);
    });
});

describe('the admin has one loader', () => {
    it('no page writes "Loading..." as plain text or beside a spinner any more', () => {
        const pages = ['(feedback)/feedback.page.ts', '(messages)/messages.page.ts', '(transactions)/transactions.page.ts', '(products)/products.page.ts', '(app-users)/app-users.page.html', '(settings)/automations/automations-settings.page.ts'];
        for (const page of pages) {
            const source = readFileSync(resolve(__dirname, '../../../app/pages/admin', page), 'utf8');
            expect(source, page).toContain('<arc-loader');
            expect(source, page).not.toContain("'common.state.loading'");
        }
        const table = readFileSync(resolve(__dirname, '../global-table/global-table.component.html'), 'utf8');
        expect(table).toContain('<arc-loader');
        expect(table).not.toContain('class="spinner"');
    });
});
