/**
 * The rich text editor's extensions, shared by the editor component and the
 * edit-on-page screen's in-place editor (specs/visual-editing-spec.md, VE3.2
 * build note, fix 3), so the two edit the same content the same way.
 *
 * Each editor gets its own pickers through `ArcPickers`: Insert image and
 * Attach file in the slash menu act on the editor they were typed in, so two
 * editors on one screen never mix (the old `window.uploadImage` stays as the
 * fallback for an editor that gives none).
 */
import { Injector } from '@angular/core';
import { Extension, Extensions, Node } from '@tiptap/core';
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
import { AngularRenderer } from 'ngx-tiptap';
import tippy, { Instance, Props } from 'tippy.js';
import { EmojiExtension } from './service/emoji-extension';
import { EditorImageUploadService } from './service/editor-image-upload.service';
import { FileHandlerExtension } from './service/file-handler-extension';
import { ImageMoveExtension } from './service/image-move-extension';
import { MenitonsList } from './service/mentions/mentions.component';
import { SlashCommands } from './service/slash-commands';
import { YouTubeExt } from './service/youtube-extension';
import { ArcBlock } from './service/arc-block-extension';
import { FieldPlace, FieldPlaces } from './service/field-place';
import { ArcPickers, EditorPickers } from './service/editor-pickers';
import { caretRect } from './service/caret-rect';

/** A suggestion's caret, in the admin document's coordinates. */
function frameRect(props: any): DOMRect {
  const box = props.clientRect?.() ?? { top: 0, bottom: 0, left: 0, right: 0 };
  return caretRect(props.editor?.view?.dom, box);
}
import { filterEmailTags, insertTagMention } from '../../constants/email-tags';

export interface EditorExtensionOptions {
  injector: Injector;
  translate: (key: string) => string;
  /** Merge tags offered after `#` (the email editors); none elsewhere. */
  tags?: () => string[];
  /** Follow a link on click; off where a click edits (the page). */
  openOnClick?: boolean;
  pickers?: EditorPickers;
  /** Custom fields that can be placed in the text (VE-D28): the body editor's; none elsewhere. */
  places?: FieldPlaces | null;
}

/** Every extension the rich text editor uses, configured for one editor. */
export function editorExtensions(options: EditorExtensionOptions): Extensions {
  return [
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
        items: ({ query }: any) => filterEmailTags(options.tags?.() ?? [], query),
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
              renderer = new AngularRenderer(MenitonsList, options.injector, {
                props,
              });
              renderer.updateProps({ props });

              popup = tippy(document.body as Element, {
                getReferenceClientRect: () => frameRect(props),
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
                getReferenceClientRect: () => frameRect(props),
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
      openOnClick: options.openOnClick ?? true,
      autolink: true,
      linkOnPaste: true,
      validate: (href) => /^https?:\/\//.test(href),
    }),
    // Tables: the v3 package bundles the four table nodes as TableKit.
    // They used to be left out over an import problem that is gone.
    TableKit.configure({ table: { resizable: false } }),
    // Structured blocks: FAQ, key takeaways, how-to, definition (D-D10).
    ArcBlock,
    // Always known, so a body holding a marker keeps it; offered in the menu only with places.
    FieldPlace.configure({ places: options.places ?? null }),
    SlashCommands.configure({ translate: options.translate, places: options.places ?? null }),
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
      uploadImage: (file, onProgress) => options.injector.get(EditorImageUploadService).upload(file, onProgress),
      // A document goes to the library's Files and in as a file card (MF-D20).
      uploadDocument: (file, onProgress) => options.injector.get(EditorImageUploadService).uploadDocument(file, onProgress),
      onUnsupported: (file) => options.injector.get(EditorImageUploadService).showUnsupported(file),
      onUploadError: (file, error) => options.injector.get(EditorImageUploadService).showError(file, error),
      uploadingLabel: (file, percent) => options.injector.get(EditorImageUploadService).uploadingLabel(file, percent),
    }),
    ArcPickers.configure(options.pickers ?? {}),
  ];
}
