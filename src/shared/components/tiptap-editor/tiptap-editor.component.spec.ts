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
import { Editor } from '@tiptap/core';
import { EditorImageUploadService } from './service/editor-image-upload.service';
import { SiteLook, SiteLookService } from '../../../app/core/site/site-look.service';

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
                view: { dom: document.createElement('div') },
                setOptions: vi.fn()
            };
        }),
        Extension: {
            // configure() hands back what it was given, so a spec can read the options.
            create: vi.fn().mockReturnValue({ configure: (options: unknown) => ({ configuredWith: options }) })
        },
        Node: {
            create: vi.fn().mockReturnValue({})
        }
    };
});

describe('TiptapEditorComponent', () => {
    let component: TiptapEditorComponent;
    let fixture: ComponentFixture<TiptapEditorComponent>;
    const imageUpload = {
        upload: vi.fn(),
        showError: vi.fn(),
        uploadingLabel: vi.fn(),
    };
    const releaseLook = vi.fn();
    const siteLook = { use: vi.fn(() => releaseLook) };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            providers: [
                { provide: EditorImageUploadService, useValue: imageUpload },
                { provide: SiteLookService, useValue: siteLook },
            ],
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

    // ES2 (specs/editor-site-look-spec.md): the live page's look around the editor.
    describe('site look', () => {
        const LOOK: SiteLook = {
            chain: {
                ancestors: [
                    { tag: 'article', classes: ['page'], id: 'top' },
                    { tag: 'div', classes: ['container'], id: null },
                    { tag: 'div', classes: ['wrapper', 'narrow'], id: null },
                ],
                body: { tag: 'div', classes: ['article-content'], id: null },
            },
            scopeClass: 'arc-site-look-1',
            lang: 'hi',
        };
        const host = () => fixture.nativeElement.querySelector('tiptap-editor') as HTMLElement;
        const root = () => fixture.nativeElement.querySelector('.arc-site-look') as HTMLElement | null;
        const lastClasses = () => (component.editor.setOptions as any).mock.calls.at(-1)?.[0].editorProps.attributes.class;
        beforeEach(() => {
            // The previous test's editor is torn down after its afterEach, releasing its look.
            releaseLook.mockClear();
            siteLook.use.mockClear();
        });
        function show(look: SiteLook | null): void {
            fixture.componentRef.setInput('siteLook', look);
            fixture.detectChanges();
        }

        it('keeps the editor\'s own look without one', () => {
            expect(root()).toBeNull();
            expect(host().parentElement?.classList.contains('no-select')).toBe(true);
            expect(siteLook.use).not.toHaveBeenCalled();
        });

        it('rebuilds the template\'s elements around the editor, with the look\'s root and language', () => {
            show(LOOK);
            const lookRoot = root()!;
            expect(lookRoot.className).toBe('arc-site-look arc-site-look-1');
            expect(lookRoot.lang).toBe('hi');
            const article = lookRoot.firstElementChild as HTMLElement;
            expect(article.tagName).toBe('ARTICLE');
            expect(article.className).toBe('page');
            expect(article.id).toBe('top');
            const container = article.firstElementChild as HTMLElement;
            expect(container.className).toBe('container');
            // The innermost element's classes go on <tiptap-editor>, so `.wrapper > .article-content` still matches.
            expect(container.firstElementChild).toBe(host());
            expect(host().classList.contains('wrapper') && host().classList.contains('narrow')).toBe(true);
            expect(lastClasses()).toBe('custom_tip_tap_editor arc-site-look-on article-content');
            expect(siteLook.use).toHaveBeenCalledTimes(1);
            expect(siteLook.use).toHaveBeenCalledWith(LOOK);
        });

        it('leaves off an id the admin page already has', () => {
            const taken = document.createElement('div');
            taken.id = 'top';
            document.body.appendChild(taken);
            show(LOOK);
            expect((root()!.firstElementChild as HTMLElement).id).toBe('');
            taken.remove();
        });

        it('clears the indent applyMarginLeft puts on the editor\'s elements', () => {
            const dom = component.editor.view.dom as HTMLElement;
            const paragraph = document.createElement('p');
            dom.appendChild(paragraph);
            dom.style.marginLeft = '3rem';
            paragraph.style.marginLeft = '3rem';
            show(LOOK);
            expect(dom.style.marginLeft).toBe('');
            expect(paragraph.style.marginLeft).toBe('');
        });

        it('leaves an equal look as it is, so the editor keeps its focus', () => {
            show(LOOK);
            const first = root();
            show({ ...LOOK, chain: JSON.parse(JSON.stringify(LOOK.chain)) });
            expect(root()).toBe(first);
            expect(siteLook.use).toHaveBeenCalledTimes(1);
        });

        it('swaps to another look, and back to its own look, releasing the stylesheet each time', () => {
            show(LOOK);
            show({ ...LOOK, scopeClass: 'arc-site-look-2', chain: { ancestors: [], body: { tag: 'div', classes: [], id: null } } });
            expect(releaseLook).toHaveBeenCalledTimes(1);
            expect(root()!.className).toBe('arc-site-look arc-site-look-2');
            expect(root()!.firstElementChild).toBe(host());
            expect(host().classList.contains('wrapper')).toBe(false);
            expect(lastClasses()).toBe('custom_tip_tap_editor arc-site-look-on arc-site-look-body');

            show(null);
            expect(releaseLook).toHaveBeenCalledTimes(2);
            expect(root()).toBeNull();
            expect(host().parentElement?.classList.contains('no-select')).toBe(true);
            expect(lastClasses()).toBe('custom_tip_tap_editor');
        });

        it('releases the stylesheet when the editor goes', () => {
            show(LOOK);
            fixture.destroy();
            expect(releaseLook).toHaveBeenCalledTimes(1);
        });
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

    describe('Dropped and pasted images', () => {
        /** The options the editor gave the file handler extension. */
        function fileHandlerOptions(): any {
            const config = vi.mocked(Editor).mock.calls.at(-1)![0] as any;
            return config.extensions.find((ext: any) => ext?.configuredWith?.uploadImage)?.configuredWith;
        }

        it('uploads through the media library and inserts the URL it returns, never a data URL', async () => {
            imageUpload.upload.mockResolvedValue('https://storage.example/photo-m.webp');
            const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
            const onProgress = vi.fn();

            const src = await fileHandlerOptions().uploadImage(file, onProgress);

            expect(imageUpload.upload).toHaveBeenCalledWith(file, onProgress);
            expect(src).toBe('https://storage.example/photo-m.webp');
            expect(src.startsWith('data:')).toBe(false);
        });

        it('shows the failure and labels the placeholder through the same service', () => {
            const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
            const error = new Error('Invalid file type. Allowed types: JPEG, PNG, WebP, GIF.');

            fileHandlerOptions().onUploadError(file, error);
            fileHandlerOptions().uploadingLabel(file, 50);

            expect(imageUpload.showError).toHaveBeenCalledWith(file, error);
            expect(imageUpload.uploadingLabel).toHaveBeenCalledWith(file, 50);
        });

        it('no longer has the toolbar file input that read images as data URLs', () => {
            expect((component as any).handleImageUpload).toBeUndefined();
            expect(fixture.nativeElement.querySelector('input[type="file"]')).toBeNull();
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
