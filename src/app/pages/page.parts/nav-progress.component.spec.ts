import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { NavProgressComponent } from './nav-progress.component';

describe('NavProgressComponent', () => {
    it('renders a fixed, non-blocking progress bar', async () => {
        await TestBed.configureTestingModule({ imports: [NavProgressComponent] }).compileComponents();
        const fixture = TestBed.createComponent(NavProgressComponent);
        fixture.detectChanges();
        const bar: HTMLElement = fixture.nativeElement.querySelector('.arc-nav-progress');
        expect(bar).toBeTruthy();
        expect(bar.getAttribute('role')).toBe('progressbar');
        const style = getComputedStyle(bar);
        expect(style.position).toBe('fixed');
        expect(style.pointerEvents).toBe('none');
    });
});
