import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import TiptapTestPageComponent from './tiptap-test.page';

describe('TiptapTestPageComponent', () => {
    let component: TiptapTestPageComponent;
    let fixture: ComponentFixture<TiptapTestPageComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [CommonModule, FormsModule, TiptapTestPageComponent],
            schemas: [NO_ERRORS_SCHEMA] // Ignore child component errors
        }).compileComponents();

        fixture = TestBed.createComponent(TiptapTestPageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    describe('Component Creation', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });

        it('should have initial editor content', () => {
            expect(component.editorContent).toBeTruthy();
            expect(component.editorContent).toContain('Welcome to Your Notion-like Editor');
        });

        it('should render page title in template', () => {
            const compiled = fixture.nativeElement as HTMLElement;
            const title = compiled.querySelector('.page-title');
            expect(title?.textContent).toContain('Notion-like');
        });
    });

    describe('onContentChange', () => {
        it('should update editorContent when called', () => {
            const newContent = '<p>New content</p>';
            component.onContentChange(newContent);
            expect(component.editorContent).toBe(newContent);
        });

        it('should handle empty content', () => {
            component.onContentChange('');
            expect(component.editorContent).toBe('');
        });

        it('should handle HTML content', () => {
            const htmlContent = '<h1>Title</h1><p>Paragraph</p>';
            component.onContentChange(htmlContent);
            expect(component.editorContent).toBe(htmlContent);
        });
    });

    describe('setSampleContent', () => {
        it('should set sample content', () => {
            component.editorContent = '';
            component.setSampleContent();
            expect(component.editorContent).toContain('Sample Document');
        });

        it('should include feature list in sample content', () => {
            component.setSampleContent();
            expect(component.editorContent).toContain('Rich text formatting');
            expect(component.editorContent).toContain('Floating bubble menu');
            expect(component.editorContent).toContain('Slash commands');
        });
    });

    describe('clearContent', () => {
        it('should clear editor content', () => {
            component.editorContent = '<p>Some content</p>';
            component.clearContent();
            expect(component.editorContent).toBe('');
        });

        it('should clear even when content has multiple elements', () => {
            component.editorContent = '<h1>Title</h1><p>Para 1</p><p>Para 2</p>';
            component.clearContent();
            expect(component.editorContent).toBe('');
        });
    });
});
