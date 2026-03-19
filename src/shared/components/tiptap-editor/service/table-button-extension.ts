import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';

export const TableButtonsExtension = Extension.create({
  name: 'tableButtons',

  addProseMirrorPlugins() {
    const plugin = new Plugin({
      key: new PluginKey('tableButtons'),
      props: {
        decorations: (state) => {
          const { doc } = state;
          const decorations: Decoration[] = [];

          doc.descendants((node, pos) => {
            if (node.type.name === 'table') {
              // Wrap table in a div
              const tableWrapper = Decoration.node(pos, pos + node.nodeSize, {
                class: 'table-wrapper'
              });
              decorations.push(tableWrapper);

              const rightButton = Decoration.widget(pos + node.nodeSize, (view) => {
                const button = document.createElement('button');
                button.innerHTML = 'Add column';
                // button.innerHTML = '<i class="bi bi-plus"></i>';
                button.className = 'table-button add_column_row';
                button.title = 'Add Column';
                button.addEventListener('mousedown', (e) => {
                  e.preventDefault();
                  const { state } = view;
                  const resolvedPos = state.doc.resolve(pos);
                  const tr = state.tr.setSelection(TextSelection.near(resolvedPos));
                  view.dispatch(tr);
                  this.editor.chain().focus().addColumnAfter().run();
                });
                return button;
              });

              const bottomButton = Decoration.widget(pos + node.nodeSize, (view) => {
                const button = document.createElement('button');
                button.innerHTML = 'Add Row';
                // button.innerHTML = '<i class="bi bi-plus"></i>';
                button.className = 'table-button add_column_row';
                button.title = 'Add Row';
                button.addEventListener('mousedown', (e) => {
                  e.preventDefault();
                  const { state } = view;
                  const resolvedPos = state.doc.resolve(pos);
                  const tr = state.tr.setSelection(TextSelection.near(resolvedPos));
                  view.dispatch(tr);
                  this.editor.chain().focus().addRowAfter().run();
                });
                return button;
              });

              const deleteRowButton = Decoration.widget(pos + node.nodeSize, (view) => {
                const button = document.createElement('button');
                button.innerHTML = 'Delete Row';
                // button.innerHTML = '<i class="bi bi-plus"></i>';
                button.className = 'table-button add_column_row';
                button.title = 'Add Row';
                button.addEventListener('mousedown', (e) => {
                  e.preventDefault();
                  const { state } = view;
                  const resolvedPos = state.doc.resolve(pos);
                  const tr = state.tr.setSelection(TextSelection.near(resolvedPos));
                  view.dispatch(tr);
                  this.editor.chain().focus().deleteRow().run();
                });
                return button;
              });

              const deleteColButton = Decoration.widget(pos + node.nodeSize, (view) => {
                const button = document.createElement('button');
                button.innerHTML = 'Delete Column';
                // button.innerHTML = '<i class="bi bi-plus"></i>';
                button.className = 'table-button add_column_row';
                button.title = 'Add Row';
                button.addEventListener('mousedown', (e) => {
                  e.preventDefault();
                  const { state } = view;
                  const resolvedPos = state.doc.resolve(pos);
                  const tr = state.tr.setSelection(TextSelection.near(resolvedPos));
                  view.dispatch(tr);
                  this.editor.chain().focus().deleteColumn().run();
                });
                return button;
              });

              const deleteTableButton = Decoration.widget(pos + node.nodeSize, (view) => {
                const button = document.createElement('button');
                button.innerHTML = 'Delete Table';
                // button.innerHTML = '<i class="bi bi-plus"></i>';
                button.className = 'table-button add_column_row';
                button.title = 'Add Row';
                button.addEventListener('mousedown', (e) => {
                  e.preventDefault();
                  const { state } = view;
                  const resolvedPos = state.doc.resolve(pos);
                  const tr = state.tr.setSelection(TextSelection.near(resolvedPos));
                  view.dispatch(tr);
                  this.editor.chain().focus().deleteTable().run();
                });
                return button;
              });

              decorations.push(rightButton, bottomButton, deleteRowButton, deleteColButton, deleteTableButton);
            }
          });

          return DecorationSet.create(doc, decorations);
        },
      },
    });

    return [plugin];
  },
});