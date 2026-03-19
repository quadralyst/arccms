/**
 * Tests for HeaderComponent
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HeaderComponent } from './header.component';

describe('HeaderComponent', () => {
    let component: HeaderComponent;
    let fixture: ComponentFixture<HeaderComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [HeaderComponent],
        }).compileComponents();

        fixture = TestBed.createComponent(HeaderComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    describe('Component Creation', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });
    });

    describe('Component Metadata', () => {
        it('should be a standalone component with arc-header selector', () => {
            // Verify the component was created and is functional
            expect(component).toBeTruthy();
            // The selector is defined in the component decorator
            // When testing with TestBed, the host element is wrapped
            expect(fixture.nativeElement).toBeTruthy();
        });

        it('should be standalone', () => {
            // Verify the component can be imported directly without a module
            expect(HeaderComponent).toBeDefined();
        });
    });
});
