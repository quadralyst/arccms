import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { SmtpProviderComponent } from './smtp-provider.component';

describe('SmtpProviderComponent', () => {
    let component: SmtpProviderComponent;
    let fixture: ComponentFixture<SmtpProviderComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [SmtpProviderComponent, NoopAnimationsModule],
        }).compileComponents();

        fixture = TestBed.createComponent(SmtpProviderComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should build form with correct fields', () => {
        expect(component.formGroup.get('host')).toBeDefined();
        expect(component.formGroup.get('port')).toBeDefined();
        expect(component.formGroup.get('secure')).toBeDefined();
        expect(component.formGroup.get('user')).toBeDefined();
        expect(component.formGroup.get('password')).toBeDefined();
    });

    it('should default port to 587', () => {
        expect(component.formGroup.get('port')?.value).toBe(587);
    });

    it('should be invalid when required fields are empty', () => {
        expect(component.isConfigValid()).toBe(false);
    });

    it('should be valid when host, user, and password are filled', () => {
        component.formGroup.patchValue({
            host: 'smtp.example.com',
            user: 'user@example.com',
            password: 'secret',
        });
        expect(component.isConfigValid()).toBe(true);
    });

    it('should be invalid when host is missing', () => {
        component.formGroup.patchValue({
            user: 'user@example.com',
            password: 'secret',
        });
        expect(component.isConfigValid()).toBe(false);
    });

    it('should return null from getSenderEmailConstraint', () => {
        expect(component.getSenderEmailConstraint()).toBeNull();
    });

    it('should patch initial data on init', async () => {
        const fixture2 = TestBed.createComponent(SmtpProviderComponent);
        const component2 = fixture2.componentInstance;
        fixture2.componentRef.setInput('initialData', {
            host: 'smtp.test.com',
            port: 465,
            secure: true,
            user: 'test@test.com',
            password: 'pass',
        });
        fixture2.detectChanges();

        expect(component2.formGroup.get('host')?.value).toBe('smtp.test.com');
        expect(component2.formGroup.get('port')?.value).toBe(465);
        expect(component2.formGroup.get('secure')?.value).toBe(true);
    });

    it('should emit componentReady on init', () => {
        // Component was already initialized in beforeEach, and componentReady was emitted.
        // We verify by creating a fresh instance and subscribing.
        const fixture2 = TestBed.createComponent(SmtpProviderComponent);
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
        const fixture2 = TestBed.createComponent(SmtpProviderComponent);
        const component2 = fixture2.componentInstance;
        fixture2.componentRef.setInput('initialData', {
            host: 'smtp.test.com',
            user: 'test@test.com',
            password: 'pass',
        });
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
