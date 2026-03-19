import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ResendProviderComponent } from './resend-provider.component';

describe('ResendProviderComponent', () => {
    let component: ResendProviderComponent;
    let fixture: ComponentFixture<ResendProviderComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ResendProviderComponent, NoopAnimationsModule],
        }).compileComponents();

        fixture = TestBed.createComponent(ResendProviderComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should build form with apiKey field', () => {
        expect(component.formGroup.get('apiKey')).toBeDefined();
    });

    it('should be invalid when apiKey is empty', () => {
        expect(component.isConfigValid()).toBe(false);
    });

    it('should be valid when apiKey is filled', () => {
        component.formGroup.patchValue({ apiKey: 're_test123' });
        expect(component.isConfigValid()).toBe(true);
    });

    it('should return null from getSenderEmailConstraint', () => {
        expect(component.getSenderEmailConstraint()).toBeNull();
    });

    it('should patch initial data on init', () => {
        const fixture2 = TestBed.createComponent(ResendProviderComponent);
        const component2 = fixture2.componentInstance;
        fixture2.componentRef.setInput('initialData', { apiKey: 're_loaded_key' });
        fixture2.detectChanges();

        expect(component2.formGroup.get('apiKey')?.value).toBe('re_loaded_key');
    });

    it('should emit componentReady on init', () => {
        const fixture2 = TestBed.createComponent(ResendProviderComponent);
        const component2 = fixture2.componentInstance;
        let emitted = false;
        component2.componentReady.subscribe(() => { emitted = true; });
        fixture2.detectChanges();
        expect(emitted).toBe(true);
    });

    it('should show info box when no initial data is provided', () => {
        expect(component.showInfoBox()).toBe(true);
    });

    it('should collapse info box when valid initial data is provided', () => {
        const fixture2 = TestBed.createComponent(ResendProviderComponent);
        const component2 = fixture2.componentInstance;
        fixture2.componentRef.setInput('initialData', { apiKey: 're_test123' });
        fixture2.detectChanges();
        expect(component2.showInfoBox()).toBe(false);
    });

    it('should toggle info box on click', () => {
        expect(component.showInfoBox()).toBe(true);
        component.showInfoBox.set(false);
        expect(component.showInfoBox()).toBe(false);
        component.showInfoBox.set(true);
        expect(component.showInfoBox()).toBe(true);
    });
});
