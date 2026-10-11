import { Extension } from '@tiptap/core';
import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { Image } from './custom-tiptap-image-node';
import { FileCard } from './file-card-node';
import { isLibraryDocument, MediaFileRef } from '../../../utils/media-files';

/**
 * Files dropped or pasted into the editor.
 *
 * An image is uploaded through `uploadImage` (the media library, see
 * EditorImageUploadService) while a placeholder stands where it was dropped,
 * and the image goes in with the URL it resolves to. Its bytes are never put
 * in the content as a data URL: that bloats the document towards Firestore's
 * 1 MiB limit and skips the library's sizes. Without an uploader an image is
 * not added at all.
 *
 * A document the library takes (PDF, Word, Excel, PowerPoint, CSV, text) is
 * uploaded to Files through `uploadDocument` and goes in as a file card
 * (file-card-node.ts; MF-D20). Any other file is refused through
 * `onUploadError`, never put in the text.
 */
export interface FileHandlerOptions {
  /** Uploads one image and resolves to the URL to insert. */
  uploadImage: ((file: File, onProgress: (percent: number) => void) => Promise<string>) | null;
  /** Uploads one document to the library's Files and resolves to the file to link. */
  uploadDocument: ((file: File, onProgress: (percent: number) => void) => Promise<MediaFileRef>) | null;
  /** Called for a file that is neither an image nor a document the library takes. */
  onUnsupported: (file: File) => void;
  /** Called when an image could not be uploaded. */
  onUploadError: (file: File, error: unknown) => void;
  /** The placeholder's text while `file` uploads. */
  uploadingLabel: (file: File, percent: number) => string;
}

interface Placeholder {
  id: object;
  pos: number;
  dom: HTMLElement;
}

type PlaceholderAction = { add: Placeholder[] } | { remove: object[] };

export const FileHandlerKey = new PluginKey<DecorationSet>('fileHandler');

export const FileHandlerExtension = Extension.create<FileHandlerOptions>({
  name: 'fileHandler',

  addOptions() {
    return {
      uploadImage: null,
      uploadDocument: null,
      onUnsupported: (file) => console.warn(`${file.name} cannot be added here.`),
      onUploadError: (file, error) => console.error(`Could not upload ${file.name}:`, error),
      uploadingLabel: (file) => `Uploading ${file.name}...`,
    };
  },

  addExtensions() {
    return [
      Image,
      FileCard,
    ]
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<DecorationSet>({
        key: FileHandlerKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            set = set.map(tr.mapping, tr.doc);
            const action = tr.getMeta(FileHandlerKey) as PlaceholderAction | undefined;
            if (action && 'add' in action) {
              set = set.add(tr.doc, action.add.map((p) => Decoration.widget(p.pos, p.dom, { id: p.id })));
            } else if (action && 'remove' in action) {
              set = set.remove(set.find(undefined, undefined, (spec) => action.remove.includes(spec['id'])));
            }
            return set;
          },
        },
        props: {
          decorations: (state) => FileHandlerKey.getState(state),
          handleDOMEvents: {
            drop: (view: EditorView, event: DragEvent) => {
              const files = Array.from(event.dataTransfer?.files ?? []);
              if (!files.length || !view.editable) return false;

              event.preventDefault();
              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
              handleFiles(view, files, pos, options);
              return true;
            },
            paste: (view: EditorView, event: ClipboardEvent) => {
              const files = Array.from(event.clipboardData?.files ?? []);
              // Word, Excel and the like put a picture of the copied text on
              // the clipboard beside the text itself: the text is what was meant.
              if (!files.length || !view.editable || htmlHasText(event.clipboardData?.getData('text/html'))) return false;

              event.preventDefault();
              handleFiles(view, files, view.state.selection.from, options);
              return true;
            },
          },
        },
      }),
    ];
  },
});

function isImage(file: File): boolean {
  return file.type.split('/')[0] === 'image';
}

/** True when pasted HTML carries words, not just an image. */
export function htmlHasText(html: string | undefined): boolean {
  if (!html) return false;
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  return !!body.textContent?.trim();
}

function isDocument(file: File): boolean {
  return !isImage(file) && isLibraryDocument(file.name);
}

function handleFiles(view: EditorView, files: File[], pos: number, options: FileHandlerOptions): void {
  const wanted = files.filter((file) =>
    (isImage(file) && options.uploadImage) || (isDocument(file) && options.uploadDocument));
  for (const file of files) {
    if (!isImage(file) && !isDocument(file)) options.onUnsupported(file);
  }
  if (!wanted.length) return;
  void uploadFiles(view, wanted, pos, options);
}

/**
 * One placeholder per file, all at `pos`, then one upload at a time so the
 * images and file cards land in the order they were dropped.
 */
async function uploadFiles(
  view: EditorView,
  files: File[],
  pos: number,
  options: FileHandlerOptions,
): Promise<void> {
  const placeholders = files.map((file) => ({
    file,
    id: {},
    dom: placeholderDom(view.dom.ownerDocument, options.uploadingLabel(file, 0)),
  }));
  view.dispatch(view.state.tr.setMeta(FileHandlerKey, { add: placeholders.map((p) => ({ id: p.id, pos, dom: p.dom })) }));

  for (const placeholder of placeholders) {
    const { file, id, dom } = placeholder;
    try {
      const onProgress = (percent: number) => {
        dom.textContent = options.uploadingLabel(file, percent);
      };
      let node;
      if (isImage(file)) {
        const src = await options.uploadImage!(file, onProgress);
        if (view.isDestroyed) return;
        node = view.state.schema.nodes['image'].create({ src });
      } else {
        const uploaded = await options.uploadDocument!(file, onProgress);
        if (view.isDestroyed) return;
        node = view.state.schema.nodes['fileCard'].create({
          href: uploaded.url, title: uploaded.title, type: uploaded.type, bytes: uploaded.bytes, pages: uploaded.pages ?? null,
        });
      }
      const at = findPlaceholder(view.state, id);
      // Gone with the text around it: the admin deleted it while it uploaded.
      if (at === null) continue;
      view.dispatch(view.state.tr.replaceWith(at, at, node).setMeta(FileHandlerKey, { remove: [id] }));
    } catch (error) {
      if (!view.isDestroyed) {
        view.dispatch(view.state.tr.setMeta(FileHandlerKey, { remove: [id] }));
      }
      options.onUploadError(file, error);
    }
  }
}

function findPlaceholder(state: EditorState, id: object): number | null {
  const found = FileHandlerKey.getState(state)?.find(undefined, undefined, (spec) => spec['id'] === id);
  return found?.length ? found[0].from : null;
}

function placeholderDom(doc: Document, label: string): HTMLElement {
  const dom = doc.createElement('span');
  dom.className = 'arc-image-uploading';
  dom.setAttribute('contenteditable', 'false');
  dom.setAttribute('role', 'status');
  dom.style.cssText = 'display:inline-block;padding:0.5rem 0.75rem;margin:0.25rem 0;border:1px dashed currentColor;border-radius:6px;opacity:0.7;font-size:0.875rem;';
  dom.textContent = label;
  return dom;
}
