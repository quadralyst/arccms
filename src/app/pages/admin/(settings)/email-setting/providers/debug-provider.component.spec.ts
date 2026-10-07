import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DebugProviderComponent } from './debug-provider.component';

describe('DebugProviderComponent', () => {
    let page: HTMLElement;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [DebugProviderComponent, NoopAnimationsModule],
            providers: [provideRouter([])],
        }).compileComponents();

        const fixture = TestBed.createComponent(DebugProviderComponent);
        fixture.detectChanges();
        page = fixture.nativeElement;
    });

    it('needs no configuration', () => {
        expect(TestBed.createComponent(DebugProviderComponent).componentInstance.isConfigValid()).toBe(true);
    });

    it('warns that the sign-up page shows sign-up codes, and link codes stay in Email Logs', () => {
        const warning = page.querySelector('.sign-up-codes')?.textContent ?? '';
        expect(warning).toContain('shows sign-up codes on screen');
        expect(warning).toContain('anyone can sign up with any address');
        expect(warning).toContain('in Email Logs only');
    });
});
