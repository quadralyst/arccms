import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';

export const ImageDropExtension = Extension.create({
  name: 'imageDrop',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('imageDrop'),
        props: {
          handleDOMEvents: {
            drop: (view, event) => {
              const hasFiles = event.dataTransfer &&
                event.dataTransfer.files &&
                event.dataTransfer.files.length;

              if (!hasFiles) {
                return false;
              }

              const images = Array.from(event.dataTransfer.files).filter(file => 
                /image/i.test(file.type)
              );

              if (images.length === 0) {
                return false;
              }

              event.preventDefault();

              const { schema } = view.state;
              const coordinates: any = view.posAtCoords({ left: event.clientX, top: event.clientY });

              images.forEach(image => {
                const reader = new FileReader();

                reader.onload = (readerEvent: any) => {
                  const node = schema.nodes['image'].create({
                    src: readerEvent.target.result
                  });
                  const transaction = view.state.tr.insert(coordinates.pos, node);
                  view.dispatch(transaction);
                };

                reader.readAsDataURL(image);
              });

              return true;
            },
          },
        },
      }),
    ];
  },
});