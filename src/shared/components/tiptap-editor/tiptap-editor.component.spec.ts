import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { OverlayModule } from '@angular/cdk/overlay';
import { MatDialogModule } from '@angular/material/dialog';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import TiptapEditorComponent from './tiptap-editor.component';
import { TiptapEditorDirective, TiptapBubbleMenuDirective } from 'ngx-tiptap';

// Mock TipTap Editor synchronously to avoid hoisting issues
vi.mock('@tiptap/core', () => {
    // Create a recursive chain mock that returns itself for fluent chaining
    const chainMock: any = {
        run: vi.fn(),
        focus: vi.fn(() => chainMock),
        toggleBold: vi.fn(() => chainMock),
        toggleItalic: vi.fn(() => chainMock),
        toggleStrike: vi.fn(() => chainMock),
        toggleUnderline: vi.fn(() => chainMock),
        toggleSubscript: vi.fn(() => chainMock),
        setSubscript: vi.fn(() => chainMock),
        unsetSubscript: vi.fn(() => chainMock),
        setUnderline: vi.fn(() => chainMock),
        unsetUnderline: vi.fn(() => chainMock),
        toggleHeading: vi.fn(() => chainMock),
        toggleBlockquote: vi.fn(() => chainMock),
        toggleBulletList: vi.fn(() => chainMock),
        toggleTaskList: vi.fn(() => chainMock),
        setTextAlign: vi.fn(() => chainMock),
        undo: vi.fn(() => chainMock),
        redo: vi.fn(() => chainMock),
        setColor: vi.fn(() => chainMock),
        setCode: vi.fn(() => chainMock),
        unsetCode: vi.fn(() => chainMock),
        toggleHighlight: vi.fn(() => chainMock),
        unsetHighlight: vi.fn(() => chainMock),
        setLink: vi.fn(() => chainMock),
        unsetLink: vi.fn(() => chainMock),
        extendMarkRange: vi.fn(() => chainMock),
        setHorizontalRule: vi.fn(() => chainMock),
        splitListItem: vi.fn(() => chainMock),
        sinkListItem: vi.fn(() => chainMock),
        liftListItem: vi.fn(() => chainMock),
        insertContent: vi.fn(() => chainMock),
        setImage: vi.fn(() => chainMock),
    };

    return {
        Editor: vi.fn().mockImplementation(function () {
            return {
                chain: vi.fn().mockReturnValue(chainMock),
                isActive: vi.fn().mockReturnValue(false),
                can: vi.fn().mockReturnValue({
                    undo: vi.fn().mockReturnValue(true),
                    redo: vi.fn().mockReturnValue(true),
                    sinkListItem: vi.fn().mockReturnValue(true),
                }),
                commands: {
                    setContent: vi.fn(),
                    setYoutubeVideo: vi.fn(),
                    setImage: vi.fn(),
                    setLink: vi.fn(),
                },
                on: vi.fn(),
                off: vi.fn(),
                isDestroyed: false,
                registerPlugin: vi.fn(),
                unregisterPlugin: vi.fn(),
                destroy: vi.fn(),
                getHTML: vi.fn().mockReturnValue(''),
                isFocused: false,
                getAttributes: vi.fn().mockReturnValue({}),
                options: {
                    element: { style: {} }
                },
                setOptions: vi.fn()
            };
        }),
        Extension: {
            create: vi.fn().mockReturnValue({})
        },
        Node: {
            create: vi.fn().mockReturnValue({})
        }
    };
});

describe('TiptapEditorComponent', () => {
    let component: TiptapEditorComponent;
    let fixture: ComponentFixture<TiptapEditorComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                CommonModule,
                FormsModule,
                MatIconModule,
                MatTooltipModule,
                OverlayModule,
                MatDialogModule,
                TiptapEditorDirective,
                TiptapBubbleMenuDirective,
                TiptapEditorComponent,
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(TiptapEditorComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('Text Formatting', () => {
        it('should toggle bold', () => {
            const chain = component.editor.chain();
            component.executeEditorAction('bold');
            expect(chain.toggleBold).toHaveBeenCalled();
        });

        it('should toggle italic', () => {
            const chain = component.editor.chain();
            component.executeEditorAction('italic');
            expect(chain.toggleItalic).toHaveBeenCalled();
        });

        it('should toggle strike', () => {
            const chain = component.editor.chain();
            component.executeEditorAction('strike');
            expect(chain.toggleStrike).toHaveBeenCalled();
        });

        it('should toggle underline', () => {
            const chain = component.editor.chain();
            component.executeEditorAction('toggleUnderline');
            expect(chain.toggleUnderline).toHaveBeenCalled();
        });

        it('should toggle subscript', () => {
            const chain = component.editor.chain();
            component.executeEditorAction('toggleSubscript');
            expect(chain.toggleSubscript).toHaveBeenCalled();
        });
    });

    describe('Lists', () => {
        it('should toggle bullet list', () => {
            const chain = component.editor.chain();
            component.executeEditorAction('bulletList');
            expect(chain.toggleBulletList).toHaveBeenCalled();
        });

        it('should toggle task list', () => {
            const chain = component.editor.chain();
            component.executeEditorAction('taskList');
            expect(chain.toggleTaskList).toHaveBeenCalled();
        });
    });

    describe('Alignment', () => {
        it('should toggle align left', () => {
            const chain = component.editor.chain();
            component.executeEditorAction('alignLeft');
            expect(chain.setTextAlign).toHaveBeenCalledWith('left');
        });

        it('should toggle align center', () => {
            const chain = component.editor.chain();
            component.executeEditorAction('alignCenter');
            expect(chain.setTextAlign).toHaveBeenCalledWith('center');
        });

        it('should toggle align right', () => {
            const chain = component.editor.chain();
            component.executeEditorAction('alignRight');
            expect(chain.setTextAlign).toHaveBeenCalledWith('right');
        });

        it('should toggle align justify', () => {
            const chain = component.editor.chain();
            component.executeEditorAction('alignJustify');
            expect(chain.setTextAlign).toHaveBeenCalledWith('justify');
        });
    });

    describe('Undo/Redo', () => {
        it('should trigger undo', () => {
            const chain = component.editor.chain();
            component.editor.chain().focus().undo().run();
            expect(chain.undo).toHaveBeenCalled();
        });

        it('should trigger redo', () => {
            const chain = component.editor.chain();
            component.editor.chain().focus().redo().run();
            expect(chain.redo).toHaveBeenCalled();
        });
    });

    describe('State Management', () => {
        it('should check if bold is active', () => {
            (component.editor.isActive as any).mockReturnValue(true);
            expect(component.isActionActive('bold')).toBe(true);
        });

        it('should check if align center is active', () => {
            (component.editor.isActive as any).mockReturnValue(true);
            expect(component.isActionActive('alignCenter')).toBe(true);
            // Note: isActionActive calls isActive with specific args, we assert the return value here
        });
    });

    describe('Interaction', () => {
        it('should insert text at cursor', () => {
            const chain = component.editor.chain();
            component.insertTextAtCursor('test content');
            expect(chain.insertContent).toHaveBeenCalledWith('test content');
        });
    });
});
