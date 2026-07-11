import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, beforeEach, it, expect } from 'vitest';
import { IfEntitledDirective } from './if-entitled.directive';
import { EntitlementService } from './entitlement.service';

@Component({
    standalone: true,
    imports: [IfEntitledDirective],
    template: `<div *appIfEntitled="min">MEMBER-ONLY</div>`,
})
class HostComponent {
    min = 0;
}

describe('IfEntitledDirective', () => {
    const isPro = signal(false);
    const tierRank = signal(-1);
    const mockEnt = { isPro, tierRank };

    let fixture: ComponentFixture<HostComponent>;

    beforeEach(() => {
        isPro.set(false);
        tierRank.set(-1);
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [HostComponent],
            providers: [{ provide: EntitlementService, useValue: mockEnt }],
        });
    });

    /** Create the host with `min` set BEFORE first change detection (avoids NG0100). */
    function create(min = 0) {
        fixture = TestBed.createComponent(HostComponent);
        fixture.componentInstance.min = min;
        fixture.detectChanges();
    }

    function text() {
        return fixture.nativeElement.textContent as string;
    }

    it('hides content for a non-member', () => {
        create();
        expect(text()).not.toContain('MEMBER-ONLY');
    });

    it('shows content once the user is Pro', () => {
        create();
        isPro.set(true);
        tierRank.set(0);
        fixture.detectChanges();
        expect(text()).toContain('MEMBER-ONLY');
    });

    it('respects a minimum tier', () => {
        create(2);
        isPro.set(true);
        tierRank.set(1); // below the required tier
        fixture.detectChanges();
        expect(text()).not.toContain('MEMBER-ONLY');

        tierRank.set(2); // now meets it
        fixture.detectChanges();
        expect(text()).toContain('MEMBER-ONLY');
    });
});
