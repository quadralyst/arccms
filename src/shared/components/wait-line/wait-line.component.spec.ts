/**
 * <arc-wait-line>: the words and, unless the busy button shows its own, a small spinner
 * (F33, F38).
 */
import { describe, expect, it } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { translocoTestingModule } from '../../../test/transloco-test-providers';
import { english } from '../../../test/english';
import { WaitLineComponent } from './wait-line.component';

@Component({
    standalone: true,
    imports: [WaitLineComponent],
    template: `<arc-wait-line [waiting]="waiting()" [spinner]="spinner()" />`,
})
class HostComponent {
    readonly waiting = signal(false);
    readonly spinner = signal(true);
}

function render() {
    TestBed.configureTestingModule({ imports: [HostComponent, translocoTestingModule()] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const line = () => fixture.nativeElement.querySelector('.wait-line') as HTMLElement;
    return { fixture, host: fixture.componentInstance, line };
}

describe('WaitLineComponent', () => {
    it('says nothing and shows nothing while nothing waits', () => {
        const { line } = render();
        expect(line().textContent!.trim()).toBe('');
        expect(line().querySelector('.spinner-border')).toBeNull();
    });

    it('shows a spinner beside "Checking…" by default', () => {
        const { fixture, host, line } = render();
        host.waiting.set(true);
        fixture.detectChanges();
        expect(line().textContent!.trim()).toBe(english('member.wait.checking'));
        expect(line().querySelector('.spinner-border')).not.toBeNull();
    });

    it('keeps only the words under a button that shows its own spinner', () => {
        const { fixture, host, line } = render();
        host.spinner.set(false);
        host.waiting.set(true);
        fixture.detectChanges();
        expect(line().textContent!.trim()).toBe(english('member.wait.checking'));
        expect(line().querySelector('.spinner-border')).toBeNull();
    });
});
