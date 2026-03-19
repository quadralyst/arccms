import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

export const DragHandleKey = new PluginKey('dragHandle');

export const DragHandleExtension = Extension.create({
  name: 'dragHandle',

  addOptions() {
    return {
      dragHandleClass: 'drag-handle',
    };
  },

  addProseMirrorPlugins() {
    const { dragHandleClass } = this.options;

    return [
      new Plugin({
        key: DragHandleKey,
        props: {
          handleDOMEvents: {
            mousedown: (view: EditorView, event: MouseEvent) => {
              if (!(event.target instanceof HTMLElement)) return false;
              
              const dragHandle: any = event.target.closest(`.${dragHandleClass}`);
              if (!dragHandle) return false;

              event.preventDefault();
              
              const { top, left } = dragHandle.getBoundingClientRect();
              const startY = event.clientY;
              
              const onMouseMove = (e: MouseEvent) => {
                const deltaY = e.clientY - startY;
                dragHandle.style.transform = `translateY(${deltaY}px)`;
              };
              
              const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                dragHandle.style.transform = '';
                
                // Update the document structure based on where the node was dragged
                // Implement drag end logic here if needed
              };
              
              document.addEventListener('mousemove', onMouseMove);
              document.addEventListener('mouseup', onMouseUp);
              
              return true;
            },
          },
        },
      }),
    ];
  },

  addNodeView() {
    return ({ editor }: any) => {
      const dom = document.createElement('div');
      dom.classList.add(this['options'].dragHandleClass);
      dom.innerHTML = '⋮';
      dom.contentEditable = 'false';
      
      return {
        dom,
        update: () => {
          // Update logic if needed
          return true;
        },
        destroy: () => {
          // Cleanup logic if needed
        },
      };
    };
  },
});