import { Extension } from '@tiptap/core';
import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { Image } from './custom-tiptap-image-node';

/**
 * Files dropped or pasted into the editor.
 *
 * An image is uploaded through `uploadImage` (the media library, see
 * EditorImageUploadService) while a placeholder stands where it was dropped,
 * and the image goes in with the URL it resolves to. Its bytes are never put
 * in the content as a data URL: that bloats the document towards Firestore's
 * 1 MiB limit and skips the library's sizes. Without an uploader an image is
 * not added at all. A drop with no image in it keeps the old `[File: name]`
 * marker.
 */
export interface FileHandlerOptions {
  /** Uploads one image and resolves to the URL to insert. */
  uploadImage: ((file: File, onProgress: (percent: number) => void) => Promise<string>) | null;
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
      onUploadError: (file, error) => console.error(`Could not upload ${file.name}:`, error),
      uploadingLabel: (file) => `Uploading ${file.name}...`,
    };
  },

  addExtensions() {
    return [
      Image,
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
              if (!files.length) return false;

              event.preventDefault();
              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
              handleFiles(view, files, pos, options);
              return true;
            },
            paste: (view: EditorView, event: ClipboardEvent) => {
              const files = Array.from(event.clipboardData?.files ?? []);
              // Word, Excel and the like put a picture of the copied text on
              // the clipboard beside the text itself: the text is what was meant.
              if (!files.length || htmlHasText(event.clipboardData?.getData('text/html'))) return false;

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

function handleFiles(view: EditorView, files: File[], pos: number, options: FileHandlerOptions): void {
  const images = files.filter(isImage);
  if (!images.length) {
    view.dispatch(view.state.tr.insertText(`[File: ${files[0].name}]`, pos));
    return;
  }
  if (!options.uploadImage) return;
  void uploadImages(view, images, pos, options, options.uploadImage);
}

/**
 * One placeholder per image, all at `pos`, then one upload at a time so the
 * images land in the order they were dropped.
 */
async function uploadImages(
  view: EditorView,
  images: File[],
  pos: number,
  options: FileHandlerOptions,
  uploadImage: NonNullable<FileHandlerOptions['uploadImage']>,
): Promise<void> {
  const placeholders = images.map((file) => ({
    file,
    id: {},
    dom: placeholderDom(view.dom.ownerDocument, options.uploadingLabel(file, 0)),
  }));
  view.dispatch(view.state.tr.setMeta(FileHandlerKey, { add: placeholders.map((p) => ({ id: p.id, pos, dom: p.dom })) }));

  for (const placeholder of placeholders) {
    const { file, id, dom } = placeholder;
    try {
      const src = await uploadImage(file, (percent) => {
        dom.textContent = options.uploadingLabel(file, percent);
      });
      if (view.isDestroyed) return;
      const at = findPlaceholder(view.state, id);
      // Gone with the text around it: the admin deleted it while it uploaded.
      if (at === null) continue;
      const image = view.state.schema.nodes['image'].create({ src });
      view.dispatch(view.state.tr.replaceWith(at, at, image).setMeta(FileHandlerKey, { remove: [id] }));
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
