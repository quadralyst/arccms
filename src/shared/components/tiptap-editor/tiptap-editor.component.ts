import { OverlayModule } from '@angular/cdk/overlay';
import { CommonModule, DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  forwardRef,
  HostListener,
  inject,
  Inject,
  Injector,
  Input,
  Output,
  PLATFORM_ID,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { Editor, Extension, Node } from '@tiptap/core';
import { Color } from '@tiptap/extension-color';
import Dropcursor from '@tiptap/extension-dropcursor';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import ListKeymap from '@tiptap/extension-list-keymap';
import Mention from '@tiptap/extension-mention';
import { Placeholder } from '@tiptap/extension-placeholder';
import Subscript from '@tiptap/extension-subscript';
// Table extensions removed temporarily due to import issues
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import Typography from '@tiptap/extension-typography';
import Underline from '@tiptap/extension-underline';
import Youtube from '@tiptap/extension-youtube';
import StarterKit from '@tiptap/starter-kit';
import { AngularRenderer, TiptapEditorDirective, TiptapBubbleMenuDirective } from 'ngx-tiptap';
import tippy, { Instance, Props } from 'tippy.js';
import { ImageDropExtension } from './service/drag-drop-extension';
import { EmojiExtension } from './service/emoji-extension';
import { FileHandlerExtension } from './service/file-handler-extension';
import { ImageMoveExtension } from './service/image-move-extension';
import { MenitonsList } from './service/mentions/mentions.component';
import { SlashCommands } from './service/slash-commands';
import { UrlAddDialog } from './service/url-add-dialog/add-url.component';
import { YouTubeExt } from './service/youtube-extension';
import MediaManagerComponent from '../../../app/pages/admin/(media)/media.page';

declare global {
  interface Window {
    uploadImage: () => void;
  }
  interface Window {
    setUrl: (type: string) => void;
  }
}

export type EditorActionType =
  // Text formatting
  | 'bold'
  | 'italic'
  | 'strike'
  | 'underline'
  // Headings
  | 'heading1'
  | 'heading2'
  | 'heading3'
  // Alignment
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignJustify'
  // Lists
  | 'bulletList'
  | 'taskList'
  | 'splitListItem'
  | 'sinkListItem'
  | 'liftListItem'
  | 'sinkTaskItem'
  // Block elements
  | 'blockquote'
  | 'horizontalRule'
  // Code
  | 'setCode'
  | 'unsetCode'
  // Highlight
  | 'highlight'
  | 'unsetHighlight'
  // Links
  | 'setLink'
  | 'unsetLink'
  // Subscript
  | 'toggleSubscript'
  | 'setSubscript'
  | 'unsetSubscript'
  // Underline
  | 'toggleUnderline'
  | 'setUnderline'
  | 'unsetUnderline'
  // Color
  | 'setColor';

export interface EditorActionPayload {
  color?: string;
  url?: string;
  level?: number;
  align?: 'left' | 'center' | 'right' | 'justify';
}

@Component({
  selector: 'app-tiptap-editor',
  standalone: true,
  imports: [TiptapEditorDirective, TiptapBubbleMenuDirective, CommonModule, FormsModule, MatIconModule, MatTooltip, OverlayModule],
  templateUrl: './tiptap-editor.component.html',
  styleUrl: './tiptap-editor.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TiptapEditorComponent),
      multi: true,
    },
  ],
})
export default class TiptapEditorComponent {
  @ViewChild('contentArea', { static: true }) contentArea!: ElementRef;
  @Output() heightChanged = new EventEmitter<number>();
  showFiller = false;
  isOpenFormateOverlay = false;
  isOpenListTypeOverlay = false;
  isOpenAlignOverlay = false;
  injector = inject(Injector);
  @ViewChild('fileInput') fileInput!: ElementRef;
  dialog = inject(MatDialog);
  allUsers: any[] = [];
  editor!: Editor;
  @Output() textEditorContent = new EventEmitter();
  @Input() indexEditor: any;
  @Input() parentEvent: string = '';
  @Input() productValue: any;
  editorContentValue: any = '';

  editorDefaultValue = ``;
  appendValue = `  <p></p>
  <p></p>
  <p></p>
  <p></p>
  <p></p>
  <p></p>
  <p></p>
  <p></p>
  <p></p>
  <p></p>
  <p></p>
  <p></p>
  <p></p>
  <p></p>`;

  private isBrowser: boolean;

  constructor(
    @Inject(DOCUMENT) private document: Document,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit() {
    // Skip editor initialization during SSR - TipTap requires window object
    if (!this.isBrowser) {
      return;
    }

    this.initializeEditor();
    window.uploadImage = () => {
      this.openMediaManagerModal();
    };

    window.setUrl = (type) => {
      // this.openToAddUrlModal(type);
    };

    let previousContent = this.editor?.getHTML() || '';

    this.editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) {
        const currentContent = this.editor?.getHTML();
        if (currentContent !== previousContent) {
          previousContent = currentContent;
          this.textEditorContent.emit(currentContent);
        }
      }
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['parentEvent'] && changes['parentEvent'].currentValue) {
      const command = changes['parentEvent'].currentValue as keyof Editor['chain'];

      if (typeof this.editor.chain().focus()[command] === 'function') {
        (this.editor.chain().focus()[command] as () => any)().run();
      } else {
        console.warn(`Invalid command: ${command}`);
        if (command === 'link') {
          // this.openToAddUrlModal('link');
        }
      }
    }

    if (changes['productValue'] && changes['productValue'].currentValue !== undefined) {
      const newContent = changes['productValue'].currentValue;
      const currentContent = this.editor?.getHTML();

      // Only update content if:
      // 1. The content is actually different
      // 2. The editor doesn't have focus (user isn't actively typing)
      // 3. The new content isn't just whitespace differences
      if (
        newContent !== currentContent &&
        !this.editor?.isFocused &&
        this.normalizeContent(newContent) !== this.normalizeContent(currentContent)
      ) {
        this.editorContentValue = newContent;
        this.editor?.commands.setContent(newContent);
      }
    }
  }

  // Add this helper method to normalize content for comparison
  private normalizeContent(content: string): string {
    return content?.replace(/\s+/g, ' ').trim() || '';
  }
  initializeEditor() {
    this.editor = new Editor({
      autofocus: false,
      enablePasteRules: false,
      content: this.productValue ? this.productValue : '',
      extensions: [
        Extension.create({
          name: 'styleAttributes',
          addGlobalAttributes() {
            return [
              {
                types: [
                  'paragraph',
                  'heading',
                  'image',
                  'table',
                  'tableRow',
                  'tableHeader',
                  'tableCell',
                  'listItem',
                  'bulletList',
                  'orderedList',
                  'div',
                ],
                attributes: {
                  style: {
                    default: null,
                    parseHTML: (element) => element.getAttribute('style'),
                    renderHTML: (attributes) => {
                      if (!attributes['style']) {
                        return {};
                      }
                      return { style: attributes['style'] };
                    },
                  },
                  class: {
                    default: null,
                    parseHTML: (element) => element.getAttribute('class'),
                    renderHTML: (attributes) => {
                      if (!attributes['class']) {
                        return {};
                      }
                      return { class: attributes['class'] };
                    },
                  },
                },
              },
            ];
          },
        }),
        Node.create({
          name: 'div',
          group: 'block',
          content: 'block*',
          parseHTML() {
            return [{ tag: 'div' }];
          },
          renderHTML({ HTMLAttributes }) {
            return ['div', HTMLAttributes, 0];
          },
        }),
        StarterKit.configure({
          // Disable extensions that we configure separately to avoid duplicates
          dropcursor: false,
        }),
        Placeholder.configure({
          placeholder: 'You can start writing from here...',
          emptyEditorClass: 'is-editor-empty',
          emptyNodeClass: 'is-empty',
          includeChildren: false,
          showOnlyWhenEditable: true,
          showOnlyCurrent: false,
        }),
        TextStyle.extend({
          addAttributes() {
            return {
              style: {
                default: null,
                parseHTML: (element) => element.getAttribute('style'),
                renderHTML: (attributes) => {
                  if (!attributes['style']) {
                    return {};
                  }
                  return { style: attributes['style'] };
                },
              },
            };
          },
        }),
        // OrderedList,
        // Text,
        Color,
        // BulletList,
        // ListItem,
        ListKeymap,
        Typography,
        // Dropcursor,
        // HorizontalRule,
        // Code,
        Subscript,
        Underline,
        Image,
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
        TextAlign.configure({
          types: ['heading', 'paragraph'],
        }),
        Dropcursor.configure({
          color: 'red',
          class: 'custom_dropcursor',
        }),
        Mention.configure({
          HTMLAttributes: { class: 'mention' },
          suggestion: {
            items: ({ query }: any) => {
              return [
                'Lea Thompson',
                'Cyndi Lauper',
                'Tom Cruise',
                'Madonna',
                'Jerry Hall',
                'Joan Collins',
                'Winona Ryder',
                'Christina Applegate',
                'Alyssa Milano',
                'Molly Ringwald',
                'Ally Sheedy',
                'Debbie Harry',
                'Olivia Newton-John',
              ]
                .filter((item) => item.toLowerCase().startsWith(query.toLowerCase()))
                .slice(0, 8);
            },
            render: () => {
              let renderer: AngularRenderer<MenitonsList, MenitonsList>;
              let popup: Instance<Props>;

              return {
                onStart: (props: any) => {
                  renderer = new AngularRenderer(MenitonsList, this.injector, {
                    props,
                  });
                  renderer.updateProps({ props });

                  popup = tippy(document.body as Element, {
                    getReferenceClientRect: props.clientRect as () => ClientRect | DOMRect,
                    appendTo: () => document.body,
                    content: renderer.dom,
                    showOnCreate: true,
                    interactive: true,
                    trigger: 'manual',
                    placement: 'bottom-start',
                  });
                },
                onUpdate(props: any) {
                  renderer.updateProps({ props });
                  popup.setProps({
                    getReferenceClientRect: props.clientRect as () => ClientRect | DOMRect,
                  });
                },
                onKeyDown(props: any) {
                  return renderer.instance.onKeyDown(props);
                },
                onExit() {
                  popup.destroy();
                  renderer.destroy();
                },
              };
            },
          },
        }),
        Highlight.configure({ multicolor: true }),
        Link.extend({
          addAttributes() {
            return {
              href: {
                default: null,
              },
              target: {
                default: this.options.HTMLAttributes['target'],
              },
              class: {
                default: null,
                parseHTML: (element) => element.getAttribute('class'),
                renderHTML: (attributes) => {
                  if (!attributes['class']) {
                    return {};
                  }
                  return { class: attributes['class'] };
                },
              },
              style: {
                default: null,
                parseHTML: (element) => element.getAttribute('style'),
                renderHTML: (attributes) => {
                  if (!attributes['style']) {
                    return {};
                  }
                  return { style: attributes['style'] };
                },
              },
            };
          },
        }).configure({
          openOnClick: true,
          autolink: true,
          linkOnPaste: true,
          validate: (href) => /^https?:\/\//.test(href),
        }),
        // Table extensions removed temporarily
        SlashCommands,
        Youtube,
        YouTubeExt,
        Youtube.configure({
          controls: true,
          nocookie: true,
          height: 400,
          allowFullscreen: true,
          autoplay: true,
          ccLanguage: 'es',
          loop: true,
          progressBarColor: 'white',
        }),
        ImageDropExtension,
        ImageMoveExtension,
        EmojiExtension,
        FileHandlerExtension,
      ],
      editorProps: {
        attributes: {
          class: 'custom_tip_tap_editor',
          spellCheck: 'false',
        },
      },
    });
  }

  ngAfterViewInit() {
    this.applyMarginLeft();
  }

  applyMarginLeft() {
    const elements = this.document.querySelectorAll('#editor-with-bubble-menu *');

    elements.forEach((element: any) => {
      element.style.marginLeft = '3rem';
    });
  }

  @HostListener('document:touchstart', ['$event'])
  preventTouch(event: TouchEvent) {
    if (event.target instanceof HTMLElement) {
      event.preventDefault();
    }
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
  }

  setColor(event: any) {
    const color = event.target.value;
    this.editor.chain().focus().setColor(color).run();
  }

  handleImageUpload(event: any) {
    const image = event.target.files[0];
    const reader = new FileReader();
    reader.onload = (e: any) => {
      const imageUrl = e.target.result;
      this.editor.chain().focus().setImage({ src: imageUrl }).run();
    };
    reader.readAsDataURL(image);
  }

  openToAddUrlModal(type: any): void {
    const msg = 'Add url whatever you want.';
    const placeholder = type === 'youtube' ? 'Youtube' : 'Link';
    const dialogRef = this.dialog.open(UrlAddDialog, {
      enterAnimationDuration: '450ms',
      exitAnimationDuration: '300ms',
      width: '70vh',
      data: {
        msg,
        placeholder,
      },
      disableClose: true,
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.editor.commands.setYoutubeVideo({ src: result, width: 640, height: 360 });
        this.editor.commands.setYoutubeVideo({ src: result });
      } else {
        this.editor.chain().focus().extendMarkRange('link').setLink({ href: result }).run();
      }
    });
  }

  /**
   * Opens the Media Manager modal for inserting media into the editor
   */
  openMediaManagerModal(): void {
    const dialogRef = this.dialog.open(MediaManagerComponent, {
      enterAnimationDuration: '450ms',
      exitAnimationDuration: '300ms',
      minWidth: '134vh',
      maxHeight: '90vh',
      panelClass: 'common-dialog-box',
      disableClose: true,
      data: {
        isDialogOpen: true,
      },
    });

    dialogRef.afterClosed().subscribe((result: { mediaUrl: string; type: string } | null) => {
      if (result && result.type === 'submit' && result.mediaUrl) {
        // Insert the selected image into the editor
        this.editor.chain().focus().setImage({ src: result.mediaUrl }).run();
      }
    });
  }

  /* ======================= Fixrd buttons event ================= */
  public executeEditorAction(action: EditorActionType, payload?: EditorActionPayload): void {
    if (!this.editor) {
      console.error('Editor is not initialized');
      return;
    }

    const chain = this.editor.chain().focus();

    switch (action) {
      // Text formatting
      case 'bold':
        chain.toggleBold().run();
        break;
      case 'italic':
        chain.toggleItalic().run();
        break;
      case 'strike':
        chain.toggleStrike().run();
        break;

      // Headings
      case 'heading1':
        chain.toggleHeading({ level: 1 }).run();
        break;
      case 'heading2':
        chain.toggleHeading({ level: 2 }).run();
        break;
      case 'heading3':
        chain.toggleHeading({ level: 3 }).run();
        break;

      // Block elements
      case 'blockquote':
        chain.toggleBlockquote().run();
        break;
      case 'horizontalRule':
        chain.setHorizontalRule().run();
        break;

      // Color
      case 'setColor':
        if (payload?.color) {
          chain.setColor(payload.color).run();
        }
        break;

      // Lists
      case 'bulletList':
        chain.toggleBulletList().run();
        break;
      case 'taskList':
        chain.toggleTaskList().run();
        break;
      case 'splitListItem':
        chain.splitListItem('listItem').run();
        break;
      case 'sinkListItem':
        chain.sinkListItem('listItem').run();
        break;
      case 'liftListItem':
        chain.liftListItem('listItem').run();
        break;
      case 'sinkTaskItem':
        chain.sinkListItem('taskItem').run();
        break;

      // Alignment
      case 'alignLeft':
        chain.setTextAlign('left').run();
        break;
      case 'alignCenter':
        chain.setTextAlign('center').run();
        break;
      case 'alignRight':
        chain.setTextAlign('right').run();
        break;
      case 'alignJustify':
        chain.setTextAlign('justify').run();
        break;

      // Code
      case 'setCode':
        chain.setCode().run();
        break;
      case 'unsetCode':
        chain.unsetCode().run();
        break;

      // Highlight
      case 'highlight':
        chain.toggleHighlight({ color: payload?.color || '#ffc078' }).run();
        break;
      case 'unsetHighlight':
        chain.unsetHighlight().run();
        break;

      // Links
      case 'setLink':
        const url = payload?.url || prompt('URL', 'https://');
        if (url) {
          chain.extendMarkRange('link').setLink({ href: url }).run();
        }
        break;
      case 'unsetLink':
        chain.unsetLink().run();
        break;

      // Subscript
      case 'toggleSubscript':
        chain.toggleSubscript().run();
        break;
      case 'setSubscript':
        chain.setSubscript().run();
        break;
      case 'unsetSubscript':
        chain.unsetSubscript().run();
        break;

      // Underline
      case 'toggleUnderline':
        chain.toggleUnderline().run();
        break;
      case 'setUnderline':
        chain.setUnderline().run();
        break;
      case 'unsetUnderline':
        chain.unsetUnderline().run();
        break;

      default:
        console.warn(`Unhandled editor action: ${action}`);
    }
  }

  public isActionActive(action: EditorActionType, payload?: EditorActionPayload): boolean {
    if (!this.editor) {
      return false;
    }

    switch (action) {
      // Text formatting
      case 'bold':
        return this.editor.isActive('bold');
      case 'italic':
        return this.editor.isActive('italic');
      case 'strike':
        return this.editor.isActive('strike');

      // Headings
      case 'heading1':
        return this.editor.isActive('heading', { level: 1 });
      case 'heading2':
        return this.editor.isActive('heading', { level: 2 });
      case 'heading3':
        return this.editor.isActive('heading', { level: 3 });

      // Block elements
      case 'blockquote':
        return this.editor.isActive('blockquote');

      // Lists
      case 'bulletList':
        return this.editor.isActive('bulletList');
      case 'taskList':
        return this.editor.isActive('taskItem');
      case 'splitListItem':
        return this.editor.isActive('listItem');
      case 'sinkListItem':
        return this.editor.isActive('listItem');
      case 'liftListItem':
        return this.editor.isActive('listItem');
      case 'sinkTaskItem':
        return this.editor.isActive('taskItem');

      // Alignment
      case 'alignLeft':
        return this.editor.isActive({ textAlign: 'left' });
      case 'alignCenter':
        return this.editor.isActive({ textAlign: 'center' });
      case 'alignRight':
        return this.editor.isActive({ textAlign: 'right' });
      case 'alignJustify':
        return this.editor.isActive({ textAlign: 'justify' });

      // Code
      case 'setCode':
      case 'unsetCode':
        return this.editor.isActive('code');

      // Highlight
      case 'highlight':
        return this.editor.isActive('highlight', { color: payload?.color || '#ffc078' });
      case 'unsetHighlight':
        return this.editor.isActive('highlight');

      // Links
      case 'setLink':
      case 'unsetLink':
        return this.editor.isActive('link');

      // Subscript
      case 'toggleSubscript':
      case 'setSubscript':
      case 'unsetSubscript':
        return this.editor.isActive('subscript');

      // Underline
      case 'toggleUnderline':
      case 'setUnderline':
      case 'unsetUnderline':
        return this.editor.isActive('underline');

      default:
        return false;
    }
  }

  /**
   * Insert text at the current cursor position.
   * This method can be called from parent components to insert placeholders, etc.
   */
  public insertTextAtCursor(text: string): void {
    if (!this.editor) {
      console.error('Editor is not initialized');
      return;
    }
    this.editor.chain().focus().insertContent(text).run();
  }

  /**
   * Focus the editor
   */
  public focus(): void {
    this.editor?.chain().focus().run();
  }
}
