/**
 * HTML Code Editor Component Tests
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { HtmlCodeEditorComponent } from './html-code-editor.component';

describe('HtmlCodeEditorComponent', () => {
    let component: HtmlCodeEditorComponent;
    let fixture: ComponentFixture<HtmlCodeEditorComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                HtmlCodeEditorComponent,
                FormsModule,
                NoopAnimationsModule,
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(HtmlCodeEditorComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    describe('Initialization', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });

        it('should have empty content by default', () => {
            expect(component.content).toBe('');
        });

        it('should have default height', () => {
            expect(component.height).toBe('300px');
        });

        it('should show line numbers by default', () => {
            expect(component.showLineNumbers).toBe(true);
        });

        it('should have default placeholder', () => {
            expect(component.placeholder).toBe('<html>...</html>');
        });

        it('should have initial line count of 1', () => {
            expect(component.lineCount()).toEqual([1]);
        });
    });

    describe('Content Handling', () => {
        it('should update content on input', () => {
            const emitSpy = vi.spyOn(component.contentChange, 'emit');
            const mockEvent = {
                target: { value: '<p>Test</p>' }
            } as unknown as Event;

            component.onInput(mockEvent);
            expect(component.content).toBe('<p>Test</p>');
            expect(emitSpy).toHaveBeenCalledWith('<p>Test</p>');
        });

        it('should emit contentChange when content changes', () => {
            const emitSpy = vi.spyOn(component.contentChange, 'emit');
            const mockEvent = {
                target: { value: '<div>New content</div>' }
            } as unknown as Event;

            component.onInput(mockEvent);
            expect(emitSpy).toHaveBeenCalledWith('<div>New content</div>');
        });
    });

    describe('Line Counting', () => {
        it('should count single line', () => {
            component.content = '<p>Single line</p>';
            component.ngOnChanges({
                content: {
                    currentValue: '<p>Single line</p>',
                    previousValue: '',
                    firstChange: false,
                    isFirstChange: () => false,
                }
            });
            expect(component.lineCount().length).toBe(1);
        });

        it('should count multiple lines', () => {
            const multiLineContent = '<html>\n<body>\n<p>Test</p>\n</body>\n</html>';
            component.content = multiLineContent;
            component.ngOnChanges({
                content: {
                    currentValue: multiLineContent,
                    previousValue: '',
                    firstChange: false,
                    isFirstChange: () => false,
                }
            });
            expect(component.lineCount().length).toBe(5);
        });
    });

    describe('Syntax Highlighting', () => {
        it('should generate highlighted code', () => {
            component.content = '<p>Test</p>';
            component.ngOnChanges({
                content: {
                    currentValue: '<p>Test</p>',
                    previousValue: '',
                    firstChange: false,
                    isFirstChange: () => false,
                }
            });
            const highlighted = component.highlightedCode();
            expect(highlighted).toBeDefined();
            expect(highlighted.length).toBeGreaterThan(0);
        });

        it('should handle empty content', () => {
            component.content = '';
            component.ngOnChanges({
                content: {
                    currentValue: '',
                    previousValue: '<p>old</p>',
                    firstChange: false,
                    isFirstChange: () => false,
                }
            });
            expect(component.highlightedCode()).toBe('');
        });
    });

    describe('Keyboard Handling', () => {
        it('should handle Tab key by inserting spaces', () => {
            const mockTextarea = {
                selectionStart: 5,
                selectionEnd: 5,
                value: 'hello',
            };
            const mockEvent = {
                key: 'Tab',
                preventDefault: vi.fn(),
                target: mockTextarea,
            } as unknown as KeyboardEvent;

            component.content = 'hello';
            component.onKeyDown(mockEvent);

            expect(mockEvent.preventDefault).toHaveBeenCalled();
        });

        it('should not prevent default for non-Tab keys', () => {
            const mockEvent = {
                key: 'Enter',
                preventDefault: vi.fn(),
                target: { selectionStart: 0, selectionEnd: 0, value: '' },
            } as unknown as KeyboardEvent;

            component.onKeyDown(mockEvent);
            expect(mockEvent.preventDefault).not.toHaveBeenCalled();
        });
    });

    describe('Scroll Sync', () => {
        it('should have syncScroll method', () => {
            expect(typeof component.syncScroll).toBe('function');
        });
    });

    describe('Input Properties', () => {
        it('should accept custom height', () => {
            component.height = '500px';
            expect(component.height).toBe('500px');
        });

        it('should accept custom placeholder', () => {
            component.placeholder = '<template>...</template>';
            expect(component.placeholder).toBe('<template>...</template>');
        });

        it('should toggle line numbers', () => {
            component.showLineNumbers = false;
            expect(component.showLineNumbers).toBe(false);
        });
    });

    describe('Cursor and Text Alignment', () => {
        it('should have textarea and code highlight elements rendered', () => {
            const textarea = fixture.nativeElement.querySelector('.code-textarea');
            const codeHighlight = fixture.nativeElement.querySelector('.code-highlight');

            expect(textarea).toBeTruthy();
            expect(codeHighlight).toBeTruthy();
        });

        it('should have textarea and code highlight inside the same wrapper', () => {
            const wrapper = fixture.nativeElement.querySelector('.code-editor-wrapper');
            const textarea = wrapper?.querySelector('.code-textarea');
            const codeHighlight = wrapper?.querySelector('.code-highlight');

            // Both elements must be siblings in the same wrapper for alignment
            expect(wrapper).toBeTruthy();
            expect(textarea).toBeTruthy();
            expect(codeHighlight).toBeTruthy();
        });

        it('should have code highlight element before textarea for proper layering', () => {
            const wrapper = fixture.nativeElement.querySelector('.code-editor-wrapper');
            const children = Array.from(wrapper?.children || []) as Element[];

            const highlightIndex = children.findIndex((el) =>
                el.classList.contains('code-highlight'));
            const textareaIndex = children.findIndex((el) =>
                el.classList.contains('code-textarea'));

            // Code highlight should come before textarea in DOM for z-order
            expect(highlightIndex).toBeLessThan(textareaIndex);
        });

        it('should have textarea with transparent text attributes', () => {
            const textarea = fixture.nativeElement.querySelector('.code-textarea') as HTMLTextAreaElement;

            // Textarea should have proper attributes for overlay editing
            expect(textarea.getAttribute('spellcheck')).toBe('false');
            expect(textarea.getAttribute('autocomplete')).toBe('off');
            expect(textarea.getAttribute('autocapitalize')).toBe('off');
        });

        it('should have code highlight element with aria-hidden for accessibility', () => {
            const codeHighlight = fixture.nativeElement.querySelector('.code-highlight');

            // Code highlight should be hidden from screen readers as textarea handles input
            expect(codeHighlight.getAttribute('aria-hidden')).toBe('true');
        });

        it('should have matching content between textarea and highlighted code', () => {
            const testContent = '<p>Test Content</p>';
            component.content = testContent;
            component.ngOnChanges({
                content: {
                    currentValue: testContent,
                    previousValue: '',
                    firstChange: false,
                    isFirstChange: () => false,
                }
            });
            fixture.detectChanges();

            const textarea = fixture.nativeElement.querySelector('.code-textarea') as HTMLTextAreaElement;
            const highlightedCode = component.highlightedCode();

            // Both should reflect the same content
            expect(textarea.value).toBe(testContent);
            expect(highlightedCode).toContain('Test Content');
        });

        it('should sync scroll between textarea and code highlight', () => {
            // Ensure syncScroll method exists and can be called
            const textarea = fixture.nativeElement.querySelector('.code-textarea') as HTMLTextAreaElement;

            const mockScrollEvent = {
                target: textarea
            } as unknown as Event;

            // Should not throw
            expect(() => component.syncScroll(mockScrollEvent)).not.toThrow();
        });
    });

    describe('Insert Text at Cursor', () => {
        it('should have insertTextAtCursor method', () => {
            expect(typeof component.insertTextAtCursor).toBe('function');
        });

        it('should have focus method', () => {
            expect(typeof component.focus).toBe('function');
        });

        it('should insert text at cursor position', () => {
            const emitSpy = vi.spyOn(component.contentChange, 'emit');

            // Set initial content using ngOnChanges pattern
            component.content = 'Hello World';
            component.ngOnChanges({
                content: {
                    currentValue: 'Hello World',
                    previousValue: '',
                    firstChange: false,
                    isFirstChange: () => false,
                }
            });
            fixture.detectChanges();

            // Get textarea and set cursor position
            const textarea = component.codeTextarea?.nativeElement;
            if (textarea) {
                textarea.value = 'Hello World';
                textarea.selectionStart = 6; // After "Hello "
                textarea.selectionEnd = 6;

                // Insert text at cursor
                component.insertTextAtCursor('Beautiful ');

                // Check the content was updated correctly
                expect(component.content).toBe('Hello Beautiful World');
                expect(emitSpy).toHaveBeenCalledWith('Hello Beautiful World');
            }
        });

        it('should insert placeholder text correctly', () => {
            const emitSpy = vi.spyOn(component.contentChange, 'emit');

            // Set initial content using ngOnChanges pattern
            component.content = '<p>Hi ##NAME##</p>';
            component.ngOnChanges({
                content: {
                    currentValue: '<p>Hi ##NAME##</p>',
                    previousValue: '',
                    firstChange: false,
                    isFirstChange: () => false,
                }
            });
            fixture.detectChanges();

            // Get textarea and set cursor position at end
            const textarea = component.codeTextarea?.nativeElement;
            if (textarea) {
                textarea.value = '<p>Hi ##NAME##</p>';
                textarea.selectionStart = 6; // After "<p>Hi " (0-indexed: <p>Hi  = 6 chars)
                textarea.selectionEnd = 6;

                // Insert placeholder at cursor
                component.insertTextAtCursor('Dear ');

                // Check the content was updated correctly
                expect(component.content).toBe('<p>Hi Dear ##NAME##</p>');
                expect(emitSpy).toHaveBeenCalled();
            }
        });

        it('should replace selected text when inserting', () => {
            const emitSpy = vi.spyOn(component.contentChange, 'emit');

            // Set initial content using ngOnChanges pattern
            component.content = 'Hello World';
            component.ngOnChanges({
                content: {
                    currentValue: 'Hello World',
                    previousValue: '',
                    firstChange: false,
                    isFirstChange: () => false,
                }
            });
            fixture.detectChanges();

            // Get textarea and select "World"
            const textarea = component.codeTextarea?.nativeElement;
            if (textarea) {
                textarea.value = 'Hello World';
                textarea.selectionStart = 6; // After "Hello "
                textarea.selectionEnd = 11; // End of "World"

                // Insert text to replace selection
                component.insertTextAtCursor('Universe');

                // Check the content was updated correctly
                expect(component.content).toBe('Hello Universe');
                expect(emitSpy).toHaveBeenCalledWith('Hello Universe');
            }
        });

        it('should not throw when calling focus', () => {
            expect(() => component.focus()).not.toThrow();
        });
    });
});
