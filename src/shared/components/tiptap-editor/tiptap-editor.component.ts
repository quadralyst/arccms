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
import { TableKit } from '@tiptap/extension-table';
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
import { EmojiExtension } from './service/emoji-extension';
import { EditorImageUploadService } from './service/editor-image-upload.service';
import { FileHandlerExtension } from './service/file-handler-extension';
import { ImageMoveExtension } from './service/image-move-extension';
import { insertImageAndMoveOn } from './service/insert-image';
import { MenitonsList } from './service/mentions/mentions.component';
import { SlashCommands } from './service/slash-commands';
import { UrlAddDialog } from './service/url-add-dialog/add-url.component';
import { YouTubeExt } from './service/youtube-extension';
import { ARC_BLOCKS, ArcBlock, ArcBlockKind, ArcBlockMeta } from './service/arc-block-extension';
import MediaManagerComponent, { MediaSelection } from '../../../app/pages/admin/(media)/media.page';
import { mediaPickerDialogConfig } from '../../../app/pages/admin/(media)/media-picker-dialog';
import { filterEmailTags, insertTagMention } from '../../constants/email-tags';
import { SiteLook, SiteLookService } from '../../../app/core/site/site-look.service';

/** Two looks that would build the same editor. */
function sameLook(a: SiteLook | null, b: SiteLook | null): boolean {
  if (!a || !b) return a === b;
  return a.scopeClass === b.scopeClass && a.lang === b.lang && JSON.stringify(a.chain) === JSON.stringify(b.chain);
}

declare global {
  interface Window {
    uploadImage: () => void;
    attachFile: () => void;
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
  /** Structured blocks offered in the toolbar (specs/discoverability-spec.md, D-D10). */
  readonly arcBlocks: readonly ArcBlockMeta[] = ARC_BLOCKS;
  isOpenBlocksOverlay = false;

  insertArcBlock(kind: ArcBlockKind): void {
    this.editor.chain().focus().insertArcBlock(kind).run();
    this.isOpenBlocksOverlay = false;
  }

  insertTable(): void {
    this.editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    this.isOpenBlocksOverlay = false;
  }

  isOpenAlignOverlay = false;
  injector = inject(Injector);
  dialog = inject(MatDialog);
  allUsers: any[] = [];
  editor!: Editor;
  @Output() textEditorContent = new EventEmitter();
  @Input() indexEditor: any;
  @Input() parentEvent: string = '';
  @Input() productValue: any;
  /** Available merge tags for the `#` autocomplete (`['##NAME##', ...]`). */
  @Input() tags: string[] = [];
  /**
   * The live page's look for this field (specs/editor-site-look-spec.md, ES2):
   * the template's elements are rebuilt around the editor and its stylesheet put
   * on the page. None keeps the editor's own look, as in the email editors.
   */
  @Input() siteLook: SiteLook | null = null;
  private hostRef = inject(ElementRef);
  /** The look's root, the stand-in for the page's body, while a look is shown. */
  private lookRoot: HTMLElement | null = null;
  private shownLook: SiteLook | null = null;
  private lookHostClasses: string[] = [];
  private releaseLook: (() => void) | null = null;
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
    window.attachFile = () => {
      this.openFilePickerModal();
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
    // Before the view exists this does nothing; ngAfterViewInit shows the look then.
    if (changes['siteLook']) {
      this.showSiteLook();
    }

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
            // Trigger on '#' anywhere (mid-word included) and offer the merge tags.
            char: '#',
            allowedPrefixes: null,
            items: ({ query }: any) => filterEmailTags(this.tags ?? [], query),
            // Insert the plain `##TAG##` text (not a mention node) so the
            // server-side resolver still sees the token. Trailing space keeps
            // the inserted `##` from re-triggering the suggestion.
            command: ({ editor, range, props }: any) => insertTagMention(editor, range, props?.id ?? ''),
            render: () => {
              let renderer: AngularRenderer<MenitonsList, MenitonsList>;
              let popup: Instance<Props>;
              // Track the latest items so keyboard/visibility only engage when
              // there are tags to show (non-email editors pass no tags).
              let currentItems: string[] = [];

              return {
                onStart: (props: any) => {
                  currentItems = props.items ?? [];
                  renderer = new AngularRenderer(MenitonsList, this.injector, {
                    props,
                  });
                  renderer.updateProps({ props });

                  popup = tippy(document.body as Element, {
                    getReferenceClientRect: props.clientRect as () => ClientRect | DOMRect,
                    appendTo: () => document.body,
                    content: renderer.dom,
                    showOnCreate: currentItems.length > 0,
                    interactive: true,
                    trigger: 'manual',
                    placement: 'bottom-start',
                  });
                },
                onUpdate(props: any) {
                  currentItems = props.items ?? [];
                  renderer.updateProps({ props });
                  popup.setProps({
                    getReferenceClientRect: props.clientRect as () => ClientRect | DOMRect,
                  });
                  if (currentItems.length > 0) {
                    popup.show();
                  } else {
                    popup.hide();
                  }
                },
                onKeyDown(props: any) {
                  // No tags → let the keystroke fall through to the editor.
                  if (currentItems.length === 0) {
                    return false;
                  }
                  if (props.event?.key === 'Escape') {
                    popup.hide();
                    return true;
                  }
                  return renderer.instance.onKeyDown(props);
                },
                onExit() {
                  popup?.destroy();
                  renderer?.destroy();
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
        // Tables: the v3 package bundles the four table nodes as TableKit.
        // They used to be left out over an import problem that is gone.
        TableKit.configure({ table: { resizable: false } }),
        // Structured blocks: FAQ, key takeaways, how-to, definition (D-D10).
        ArcBlock,
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
        ImageMoveExtension,
        EmojiExtension,
        // A dropped or pasted image goes to the media library and in at the
        // Insert image size; the service is fetched only when one arrives.
        FileHandlerExtension.configure({
          uploadImage: (file, onProgress) => this.injector.get(EditorImageUploadService).upload(file, onProgress),
          // A document goes to the library's Files and in as a file card (MF-D20).
          uploadDocument: (file, onProgress) => this.injector.get(EditorImageUploadService).uploadDocument(file, onProgress),
          onUnsupported: (file) => this.injector.get(EditorImageUploadService).showUnsupported(file),
          onUploadError: (file, error) => this.injector.get(EditorImageUploadService).showError(file, error),
          uploadingLabel: (file, percent) => this.injector.get(EditorImageUploadService).uploadingLabel(file, percent),
        }),
      ],
      editorProps: {
        attributes: this.editorAttributes([]),
      },
    });
  }

  /** The editable element's attributes; with a look, the classes of the element the template fills, and `arc-site-look-on`. */
  private editorAttributes(lookClasses: string[]): Record<string, string> {
    const classes = ['custom_tip_tap_editor', ...(lookClasses.length ? ['arc-site-look-on', ...lookClasses] : [])];
    return { class: classes.join(' '), spellCheck: 'false' };
  }

  ngAfterViewInit() {
    this.applyMarginLeft();
    this.showSiteLook();
  }

  applyMarginLeft() {
    // This editor's own elements only: with several editors on a page, another's
    // could have a site look, whose spacing comes from the site.
    if (this.siteLook) return;
    const elements = this.hostRef.nativeElement.querySelectorAll('#editor-with-bubble-menu *');

    elements.forEach((element: any) => {
      element.style.marginLeft = '3rem';
    });
  }

  /**
   * Shows `siteLook` (ES2): the look's root and the template's elements around
   * the editor, the innermost one's classes on the `<tiptap-editor>` element so
   * that `.wrapper > .body` still matches, and the filled element's classes on
   * the editable element. A look equal to the one shown is left as it is, so the
   * editor keeps its focus.
   */
  private showSiteLook(): void {
    if (!this.isBrowser || !this.editor) return;
    const host = this.hostRef.nativeElement.querySelector('tiptap-editor') as HTMLElement | null;
    if (!host) return;
    const look = this.siteLook;
    if (sameLook(look, this.shownLook) && (!look || this.lookRoot)) return;

    this.hideSiteLook(host);
    this.shownLook = look;
    if (!look) {
      this.setEditorClasses([]);
      return;
    }

    const root = this.document.createElement('div');
    root.className = `arc-site-look ${look.scopeClass}`;
    if (look.lang) root.lang = look.lang;
    host.parentNode?.insertBefore(root, host);
    let parent: HTMLElement = root;
    const ancestors = look.chain.ancestors;
    for (const element of ancestors.slice(0, -1)) {
      const node = this.document.createElement(element.tag);
      if (element.classes.length) node.className = element.classes.join(' ');
      // An id the admin page already has would break its own lookups.
      if (element.id && !this.document.getElementById(element.id)) node.id = element.id;
      parent.appendChild(node);
      parent = node;
    }
    parent.appendChild(host);
    this.lookHostClasses = (ancestors[ancestors.length - 1]?.classes ?? []).filter((name) => !host.classList.contains(name));
    host.classList.add(...this.lookHostClasses);
    this.lookRoot = root;
    this.setEditorClasses(look.chain.body.classes.length ? look.chain.body.classes : ['arc-site-look-body']);
    // The inline indent from applyMarginLeft would beat the site's own spacing.
    for (const element of [this.editor.view.dom, ...Array.from(this.editor.view.dom.querySelectorAll<HTMLElement>('*'))]) {
      (element as HTMLElement).style.removeProperty('margin-left');
    }
    this.releaseLook = this.injector.get(SiteLookService).use(look);
  }

  /** Takes the look off: the editor back where it was, the classes removed, the stylesheet released. */
  private hideSiteLook(host: HTMLElement): void {
    if (this.lookRoot) {
      this.lookRoot.parentNode?.insertBefore(host, this.lookRoot);
      this.lookRoot.remove();
      this.lookRoot = null;
    }
    host.classList.remove(...this.lookHostClasses);
    this.lookHostClasses = [];
    this.releaseLook?.();
    this.releaseLook = null;
  }

  private setEditorClasses(lookClasses: string[]): void {
    if (this.editor.isDestroyed) return;
    this.editor.setOptions({
      editorProps: { ...this.editor.options.editorProps, attributes: this.editorAttributes(lookClasses) },
    });
  }

  @HostListener('document:touchstart', ['$event'])
  preventTouch(event: TouchEvent) {
    if (event.target instanceof HTMLElement) {
      event.preventDefault();
    }
  }

  ngOnDestroy(): void {
    this.releaseLook?.();
    this.releaseLook = null;
    this.editor?.destroy();
  }

  setColor(event: any) {
    const color = event.target.value;
    this.editor.chain().focus().setColor(color).run();
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
    const dialogRef = this.dialog.open(MediaManagerComponent, mediaPickerDialogConfig({ isDialogOpen: true }));

    dialogRef.afterClosed().subscribe((result: MediaSelection | null) => {
      if (result && result.type === 'submit' && result.mediaUrl) {
        // Insert the selected image into the editor, with its library alt text (MF-D22).
        insertImageAndMoveOn(this.editor, result.mediaUrl, result.alt);
      }
    });
  }

  /**
   * "Attach files": the Media Manager on its Files tab, several at once; each
   * file goes in as a card linking to it (docs/features/media.html, Files).
   */
  openFilePickerModal(): void {
    const dialogRef = this.dialog.open(MediaManagerComponent, mediaPickerDialogConfig({ isDialogOpen: true, allowFiles: true, allowImages: false, initialTab: 'files', multiple: true }));

    dialogRef.afterClosed().subscribe((result: MediaSelection | null) => {
      if (result?.type !== 'submit' || result.kind !== 'file') return;
      const files = result.files ?? (result.file ? [result.file] : []);
      let chain = this.editor.chain().focus();
      for (const file of files) chain = chain.insertFileCard(file);
      chain.run();
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
