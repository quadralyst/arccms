/**
 * Email Template Editor Component Tests
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EmailTemplateEditorComponent } from './email-template-editor.component';

describe('EmailTemplateEditorComponent', () => {
    let component: EmailTemplateEditorComponent;
    let fixture: ComponentFixture<EmailTemplateEditorComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                EmailTemplateEditorComponent,
                FormsModule,
                ReactiveFormsModule,
                NoopAnimationsModule,
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(EmailTemplateEditorComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    describe('Initialization', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });

        it('should have empty htmlContent initially', () => {
            expect(component.htmlContent).toBe('');
        });

        it('should have editor as default active tab', () => {
            expect(component.activeTab()).toBe('editor');
        });

        it('should have empty placeholders by default', () => {
            expect(component.placeholders).toEqual([]);
        });

        it('should have default label', () => {
            expect(component.label).toBe('Template Content');
        });

        it('should show HTML toggle by default', () => {
            expect(component.showHtmlToggle).toBe(true);
        });
    });

    describe('Input Value Handling', () => {
        it('should update htmlContent when value input changes', () => {
            component.value = '<p>Test content</p>';
            expect(component.htmlContent).toBe('<p>Test content</p>');
        });

        it('should format HTML content when value is set', () => {
            component.value = '<div><p>Test</p></div>';
            expect(component.formattedHtmlContent).toBeDefined();
        });

        it('should handle empty value', () => {
            component.value = '';
            expect(component.htmlContent).toBe('');
        });

        it('should handle null/undefined value', () => {
            component.value = null as any;
            expect(component.htmlContent).toBe('');
        });
    });

    describe('Tab Switching', () => {
        it('should switch to html tab', () => {
            component.setActiveTab('html');
            expect(component.activeTab()).toBe('html');
        });

        it('should switch back to editor tab', () => {
            component.setActiveTab('html');
            component.setActiveTab('editor');
            expect(component.activeTab()).toBe('editor');
        });

        it('should format HTML when switching to html tab', () => {
            component.htmlContent = '<div><p>Test</p></div>';
            component.setActiveTab('html');
            expect(component.formattedHtmlContent).toBeDefined();
        });
    });

    describe('Content Changes', () => {
        it('should emit contentChange on editor changes', () => {
            const emitSpy = vi.spyOn(component.contentChange, 'emit');
            component.onEditorChanges('<p>New content</p>');
            expect(emitSpy).toHaveBeenCalledWith('<p>New content</p>');
        });

        it('should update htmlContent on editor changes', () => {
            component.onEditorChanges('<p>Updated content</p>');
            expect(component.htmlContent).toBe('<p>Updated content</p>');
        });

        it('should emit contentChange on HTML changes', () => {
            const emitSpy = vi.spyOn(component.contentChange, 'emit');
            component.onHtmlChanges('<div>HTML content</div>');
            expect(emitSpy).toHaveBeenCalledWith('<div>HTML content</div>');
        });

        it('should update formattedHtmlContent on HTML changes', () => {
            component.onHtmlChanges('<div>HTML content</div>');
            expect(component.formattedHtmlContent).toBe('<div>HTML content</div>');
        });
    });

    describe('Placeholder Insertion', () => {
        beforeEach(() => {
            component.placeholders = ['##NAME##', '##EMAIL##', '##OTP##'];
        });

        it('should have placeholders when provided', () => {
            expect(component.placeholders.length).toBe(3);
        });

        it('should emit contentChange when placeholder inserted in editor mode', () => {
            const emitSpy = vi.spyOn(component.contentChange, 'emit');
            component.insertPlaceholder('##NAME##');
            expect(emitSpy).toHaveBeenCalled();
        });

        it('should append placeholder to content in editor mode', () => {
            component.htmlContent = 'Hello ';
            component.insertPlaceholder('##NAME##');
            expect(component.htmlContent).toContain('##NAME##');
        });
    });

    describe('HTML Formatting', () => {
        it('should format HTML with line breaks', () => {
            component.value = '<div><p>Test</p></div>';
            // The private formatHtml method should add line breaks
            expect(component.formattedHtmlContent).toContain('\n');
        });
    });

    describe('Keyboard Handling', () => {
        it('should handle Tab key in textarea', () => {
            const mockEvent = {
                key: 'Tab',
                preventDefault: vi.fn(),
                target: {
                    selectionStart: 0,
                    selectionEnd: 0,
                    value: 'test',
                } as any,
            } as KeyboardEvent;

            component.handleKeyDown(mockEvent);
            expect(mockEvent.preventDefault).toHaveBeenCalled();
        });

        it('should not prevent default for non-Tab keys', () => {
            const mockEvent = {
                key: 'Enter',
                preventDefault: vi.fn(),
                target: {} as any,
            } as KeyboardEvent;

            component.handleKeyDown(mockEvent);
            expect(mockEvent.preventDefault).not.toHaveBeenCalled();
        });
    });
});
