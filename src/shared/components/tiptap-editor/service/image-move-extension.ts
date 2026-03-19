import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';

export const ImageMoveExtension = Extension.create({
  name: 'imageMove',

  addProseMirrorPlugins() {
    let draggedImageNode: any = null;

    return [
      new Plugin({
        key: new PluginKey('imageMove'),
        props: {
          handleDOMEvents: {
            dragstart: (view, event: any) => {
              if (event.target instanceof HTMLImageElement) {
                const pos = view.posAtDOM(event.target, 0);
                draggedImageNode = view.state.doc.nodeAt(pos);
                event.dataTransfer.setData('text/plain', event.target.src);
              }
              return false;
            },
            drop: (view, event) => {
              if (!draggedImageNode) {
                return false;
              }

              event.preventDefault();

              const { schema } = view.state;
              const coordinates: any = view.posAtCoords({ left: event.clientX, top: event.clientY });

              // Find and remove the original image node
              let tr = view.state.tr;
              view.state.doc.descendants((node, pos) => {
                if (node === draggedImageNode) {
                  tr = tr.delete(pos, pos + node.nodeSize);
                  return false;
                }
                return true; 
              });

              // Insert the image at the new position
              const newNode = schema.nodes['image'].create({
                src: draggedImageNode.attrs.src,
                alt: draggedImageNode.attrs.alt,
                title: draggedImageNode.attrs.title,
              });
              tr = tr.insert(coordinates.pos, newNode);

              view.dispatch(tr);
              draggedImageNode = null;

              return true;
            },
          },
        },
      }),
    ];
  },
});