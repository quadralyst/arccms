import { Extension } from '@tiptap/core';

/** The pickers an editor's slash menu opens. */
export interface EditorPickers {
  uploadImage?: () => void;
  attachFile?: () => void;
}

/** Holds one editor's pickers in its storage (`editor.storage.arcPickers`). */
export const ArcPickers = Extension.create<EditorPickers, EditorPickers>({
  name: 'arcPickers',
  addOptions() {
    return {};
  },
  addStorage() {
    return { uploadImage: this.options.uploadImage, attachFile: this.options.attachFile };
  },
});

/** Opens a picker of the editor's own, else the page-wide one an older editor set. */
export function openEditorPicker(storage: unknown, name: keyof EditorPickers): void {
  const own = (storage as { arcPickers?: EditorPickers } | undefined)?.arcPickers?.[name];
  if (own) {
    own();
    return;
  }
  const global = (typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>)[name] : undefined);
  if (typeof global === 'function') (global as () => void)();
}
