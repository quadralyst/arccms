import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Image } from './custom-tiptap-image-node';

export const FileHandlerKey = new PluginKey('fileHandler');

export const FileHandlerExtension = Extension.create({
  name: 'fileHandler',

  addExtensions() {
    return [
      Image,
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: FileHandlerKey,
        props: {
          handleDOMEvents: {
            drop: (view: EditorView, event: DragEvent) => {
              if (!event.dataTransfer || !event.dataTransfer.files.length) return false;
              
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              handleFile(view, file, event.clientX, event.clientY);
              return true;
            },
            paste: (view: EditorView, event: ClipboardEvent) => {
              if (!event.clipboardData || !event.clipboardData.files.length) return false;
              
              event.preventDefault();
              const file = event.clipboardData.files[0];
              handleFile(view, file);
              return true;
            },
          },
        },
      }),
    ];
  },
});

function handleFile(view: EditorView, file: File, clientX?: number, clientY?: number) {
  let pos: number | undefined;
  if (clientX !== undefined && clientY !== undefined) {
    pos = view.posAtCoords({ left: clientX, top: clientY })?.pos;
  }

  if (pos === undefined) {
    pos = view.state.selection.from;
  }

  const fileType = file.type.split('/')[0];

  if (fileType === 'image') {
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      view.dispatch(
        view.state.tr.replaceWith(
          pos,
          pos,
          view.state.schema.nodes['image'].create({ src, alt: file.name })
        )
      );
    };
    reader.readAsDataURL(file);
  } else {
    const tr = view.state.tr.insertText(`[File: ${file.name}]`, pos);
    view.dispatch(tr);
  }
}