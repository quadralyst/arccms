import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { GmailProviderComponent } from './gmail-provider.component';

describe('GmailProviderComponent', () => {
    let component: GmailProviderComponent;
    let fixture: ComponentFixture<GmailProviderComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [GmailProviderComponent, NoopAnimationsModule],
        }).compileComponents();

        fixture = TestBed.createComponent(GmailProviderComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should build form with user and password fields', () => {
        expect(component.formGroup.get('user')).toBeDefined();
        expect(component.formGroup.get('password')).toBeDefined();
    });

    it('should be invalid when user or password is empty', () => {
        expect(component.isConfigValid()).toBe(false);

        component.formGroup.patchValue({ user: 'test@gmail.com' });
        expect(component.isConfigValid()).toBe(false);

        component.formGroup.patchValue({ user: '', password: 'apppassword' });
        expect(component.isConfigValid()).toBe(false);
    });

    it('should be valid when user and password are filled', () => {
        component.formGroup.patchValue({
            user: 'test@gmail.com',
            password: 'abcd efgh ijkl mnop',
        });
        expect(component.isConfigValid()).toBe(true);
    });

    it('should emit userChanged when user field changes', () => {
        const emitted: string[] = [];
        component.userChanged.subscribe(v => emitted.push(v));

        component.formGroup.get('user')!.setValue('new@gmail.com');

        expect(emitted).toContain('new@gmail.com');
    });

    it('should return user email from getSenderEmailConstraint', () => {
        expect(component.getSenderEmailConstraint()).toBeNull();

        component.formGroup.patchValue({ user: 'test@gmail.com' });
        expect(component.getSenderEmailConstraint()).toBe('test@gmail.com');
    });

    it('should return null from getSenderEmailConstraint when user is empty', () => {
        component.formGroup.patchValue({ user: '' });
        expect(component.getSenderEmailConstraint()).toBeNull();
    });

    it('should patch initial data on init', () => {
        const fixture2 = TestBed.createComponent(GmailProviderComponent);
        const component2 = fixture2.componentInstance;
        fixture2.componentRef.setInput('initialData', {
            user: 'loaded@gmail.com',
            password: 'pass1234',
        });
        fixture2.detectChanges();

        expect(component2.formGroup.get('user')?.value).toBe('loaded@gmail.com');
        expect(component2.formGroup.get('password')?.value).toBe('pass1234');
    });

    it('should emit componentReady on init', () => {
        const fixture2 = TestBed.createComponent(GmailProviderComponent);
        const component2 = fixture2.componentInstance;
        let readyComponent: any = null;
        component2.componentReady.subscribe(c => { readyComponent = c; });
        fixture2.detectChanges();
        expect(readyComponent).toBe(component2);
    });

    it('should emit initial user value on init if present', () => {
        const fixture2 = TestBed.createComponent(GmailProviderComponent);
        const component2 = fixture2.componentInstance;
        fixture2.componentRef.setInput('initialData', { user: 'init@gmail.com' });

        const emitted: string[] = [];
        component2.userChanged.subscribe(v => emitted.push(v));
        fixture2.detectChanges();

        expect(emitted).toContain('init@gmail.com');
    });

    it('should show info box when no initial data is provided', () => {
        expect(component.showInfoBox()).toBe(true);
    });

    it('should collapse info box when valid initial data is provided', () => {
        const fixture2 = TestBed.createComponent(GmailProviderComponent);
        const component2 = fixture2.componentInstance;
        fixture2.componentRef.setInput('initialData', {
            user: 'test@gmail.com',
            password: 'apppassword',
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
