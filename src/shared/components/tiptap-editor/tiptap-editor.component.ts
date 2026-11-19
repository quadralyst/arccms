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
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { Editor } from '@tiptap/core';
import { TiptapEditorDirective, TiptapBubbleMenuDirective } from 'ngx-tiptap';
import { placeImage } from './service/image-actions';
import { SelectionMenuComponent } from './selection-menu/selection-menu.component';
import { editorExtensions } from './editor-extensions';
import { UrlAddDialog } from './service/url-add-dialog/add-url.component';
import MediaManagerComponent, { MediaSelection } from '../../../app/pages/admin/(media)/media.page';
import { mediaPickerDialogConfig } from '../../../app/pages/admin/(media)/media-picker-dialog';
import { SiteLook, SiteLookService } from '../../../app/core/site/site-look.service';
import { buildLookWrappers } from '../../../app/core/site/site-look-view';

/** ngx-tiptap's default plugin key for `<tiptap-bubble-menu>`. */
const BUBBLE_MENU_KEY = 'NgxTiptapBubbleMenu';

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
  imports: [TiptapEditorDirective, TiptapBubbleMenuDirective, CommonModule, FormsModule, MatIconModule, MatTooltip, OverlayModule, TranslocoPipe, SelectionMenuComponent],
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
  /**
   * The field's name ("Body", "Summary"), for the image and file pickers'
   * heading: "Image in Summary". None leaves the pickers without a heading.
   */
  @Input() fieldName = '';
  private transloco = inject(TranslocoService);
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
      extensions: editorExtensions({
        injector: this.injector,
        translate: (key) => this.transloco.translate(key),
        tags: () => this.tags ?? [],
        pickers: { uploadImage: () => this.openMediaManagerModal(), attachFile: () => this.openFilePickerModal() },
      }),
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
      this.placeBubbleMenu(null);
      return;
    }

    const ancestors = look.chain.ancestors;
    const { root, inner } = buildLookWrappers(this.document, look, ancestors.slice(0, -1));
    host.parentNode?.insertBefore(root, host);
    inner.appendChild(host);
    this.lookHostClasses = (ancestors[ancestors.length - 1]?.classes ?? []).filter((name) => !host.classList.contains(name));
    host.classList.add(...this.lookHostClasses);
    this.lookRoot = root;
    this.setEditorClasses(look.chain.body.classes.length ? look.chain.body.classes : ['arc-site-look-body']);
    // TipTap puts the selection menu beside the editable element, which is now
    // inside the look, where it would take the site's fonts and styles: keep it
    // outside, in the editor's own wrapper.
    this.placeBubbleMenu(root.parentElement);
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

  /**
   * Where the selection menu (ngx-tiptap's bubble menu, plugin key
   * `NgxTiptapBubbleMenu`) is put when it shows; null puts it back beside the
   * editable element, TipTap's own choice.
   */
  private placeBubbleMenu(home: HTMLElement | null): void {
    if (this.editor.isDestroyed || !this.editor.state || !this.editor.view?.dispatch) return;
    this.editor.view.dispatch(this.editor.state.tr.setMeta(BUBBLE_MENU_KEY, { type: 'updateOptions', options: { appendTo: () => home } }));
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
    // Translation keys; the dialog translates them.
    const msg = type === 'youtube' ? 'common.add_url.youtube_text' : 'common.add_url.link_text';
    const placeholder = type === 'youtube' ? 'common.add_url.youtube' : 'common.add_url.link';
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
      // Cancel, or Add with the box empty, changes nothing.
      if (!result) return;
      if (type === 'youtube') {
        this.editor.commands.setYoutubeVideo({ src: result, width: 640, height: 360 });
      } else {
        this.editor.chain().focus().extendMarkRange('link').setLink({ href: result }).run();
      }
    });
  }

  /** The media picker; with a picture selected (the selection menu's Replace), its choice takes its place. */
  openMediaManagerModal(): void {
    const dialogRef = this.dialog.open(MediaManagerComponent, mediaPickerDialogConfig({ isDialogOpen: true, title: this.pickerTitle('admin.media.picker.image_in') }));

    dialogRef.afterClosed().subscribe((result: MediaSelection | null) => {
      if (result && result.type === 'submit' && result.mediaUrl) {
        // Into the editor with its library alt text (MF-D22); with a picture selected, in its place.
        placeImage(this.editor, result.mediaUrl, result.alt);
      }
    });
  }

  /**
   * "Attach files": the Media Manager on its Files tab, several at once; each
   * file goes in as a card linking to it (docs/features/media.html, Files).
   */
  openFilePickerModal(): void {
    const dialogRef = this.dialog.open(MediaManagerComponent, mediaPickerDialogConfig({
      isDialogOpen: true, allowFiles: true, allowImages: false, initialTab: 'files', multiple: true,
      title: this.pickerTitle('admin.media.picker.files_in'),
    }));

    dialogRef.afterClosed().subscribe((result: MediaSelection | null) => {
      if (result?.type !== 'submit' || result.kind !== 'file') return;
      const files = result.files ?? (result.file ? [result.file] : []);
      let chain = this.editor.chain().focus();
      for (const file of files) chain = chain.insertFileCard(file);
      chain.run();
    });
  }

  /** A picker's heading for this field ("Image in Summary"); none without a field name. */
  private pickerTitle(key: 'admin.media.picker.image_in' | 'admin.media.picker.files_in'): string | undefined {
    const field = this.fieldName.trim();
    return field ? this.transloco.translate(key, { field }) : undefined;
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
