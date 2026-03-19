import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import tippy, { Instance } from 'tippy.js';

interface SlashCommandsPluginState {
  active: boolean;
  range: { from: number; to: number } | null;
  query: string;
}

export const SlashCommandsKey = new PluginKey<SlashCommandsPluginState>('slash-commands');

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addProseMirrorPlugins() {
    let tippyInstance: Instance | null = null;
    let currentView: EditorView | null = null;

    const plugin = new Plugin({
      key: SlashCommandsKey,

      state: {
        init() {
          return { active: false, range: null, query: '' };
        },
        apply(tr, prev: SlashCommandsPluginState) {
          const { selection } = tr;
          const { $from } = selection;
          const currentLineText = $from.parent.textContent;
          const currentLinePos = $from.parentOffset;

          // Find the position of the / in the current line
          const textBeforeCursor = currentLineText.slice(0, currentLinePos);
          const slashIndex = textBeforeCursor.lastIndexOf('/');

          if (slashIndex !== -1) {
            // Extract query after the slash
            const query = textBeforeCursor.slice(slashIndex + 1);
            const slashPos = $from.pos - (currentLinePos - slashIndex);
            return {
              active: true,
              range: { from: slashPos, to: $from.pos },
              query: query
            };
          }

          // No slash found, deactivate
          return { active: false, range: null, query: '' };
        },
      },

      view(editorView) {
        currentView = editorView;
        return {
          update: (view, prevState) => {
            currentView = view;
            const pluginState = plugin.getState(view.state);
            const prevPluginState = plugin.getState(prevState);

            if (pluginState?.active) {
              showSuggestions(view, pluginState.query);
            } else if (!pluginState?.active && prevPluginState?.active) {
              hideSuggestions();
            }
          },
          destroy: () => {
            hideSuggestions();
            currentView = null;
          },
        };
      },

      props: {
        handleKeyDown(view, event) {
          const pluginState = plugin.getState(view.state);
          if (!pluginState?.active) return false;

          if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault();
            if (event.key === 'Escape') {
              hideSuggestions();
              return true;
            }
            handleMenuNavigation(event, view, pluginState.range);
            return true;
          }

          return false;
        },
      },
    });

    const showSuggestions = (view: EditorView, query: string = '') => {
      const { state } = view;
      const { selection } = state;
      const { $from } = selection;

      const allCommands = [
        {
          title: 'Heading 1',
          type: `'heading', { level: 1 }`,
          icon: 'bi bi-type-h1',
          shortcut: 'ctrl + alt + 1',
          command: () => this.editor.chain().focus().toggleHeading({ level: 1 }).run(),
        },
        {
          title: 'Heading 2',
          type: `'heading', { level: 2 }`,
          icon: 'bi bi-type-h2',
          shortcut: 'ctrl + alt + 2',
          command: () => this.editor.chain().focus().toggleHeading({ level: 2 }).run(),
        },
        {
          title: 'Heading 3',
          type: `'heading', { level: 3 }`,
          icon: 'bi bi-type-h3',
          shortcut: 'ctrl + alt + 3',
          command: () => this.editor.chain().focus().toggleHeading({ level: 3 }).run(),
        },
        {},
        {
          title: 'Bullet List',
          type: 'bulletList',
          icon: 'bi bi-list-ul',
          shortcut: 'ctrl + shift + 8',
          command: () => this.editor.chain().focus().toggleBulletList().run(),
        },
        {
          title: 'Numbered List',
          type: 'listItem',
          icon: 'bi bi-list-ol',
          shortcut: 'ctrl + shift + 7',
          command: () => this.editor.chain().focus().toggleOrderedList().run(),
        },
        {
          title: 'Task List',
          type: 'taskList',
          icon: 'bi bi-ui-checks',
          shortcut: 'ctrl + alt + 9',
          command: () => this.editor.chain().focus().toggleTaskList().run(),
        },
        {},
        {
          title: 'Insert image',
          type: 'image',
          icon: 'bi bi-image',
          shortcut: '',
          command: () => {
            (window as any).uploadImage();
          },
        },
        {
          title: 'Insert gif',
          type: 'gif',
          icon: 'bi bi-filetype-gif',
          shortcut: '',
          command: () => {
            (window as any).uploadImage();
          },
        },
        {
          title: 'Attach files',
          type: 'files',
          icon: 'bi bi-paperclip',
          shortcut: '',
          command: () => { },
        },
        {
          title: 'YouTube url',
          type: 'files',
          icon: 'bi bi-youtube',
          shortcut: '',
          command: () => {
            (window as any).setUrl('youtube');
          },
        },
        {
          title: 'Add url',
          type: 'files',
          icon: 'bi bi-link-45deg',
          shortcut: '',
          command: () => {
            (window as any).setUrl('link');
          },
        },
        {},
        {
          title: 'Code Block',
          type: 'code',
          icon: 'bi bi-code',
          shortcut: 'ctrl + alt + C',
          command: () => this.editor.chain().focus().toggleCodeBlock().run(),
        },
        {
          title: 'Divider',
          type: '',
          icon: 'bi bi-hr',
          shortcut: '',
          command: () => this.editor.chain().focus().setHorizontalRule().run(),
        },
        {
          title: 'Blockquote',
          type: '',
          icon: 'bi bi-quote',
          shortcut: 'ctrl + shift + B',
          command: () => this.editor.chain().focus().toggleBlockquote().run(),
        },
        // Table command removed - table extensions disabled
        {},
        {
          title: 'Undo',
          type: '',
          icon: 'bi bi-arrow-counterclockwise',
          shortcut: 'ctrl + Z',
          command: () => this.editor.chain().focus().undo().run(),
        },
        {
          title: 'Redo',
          type: '',
          icon: 'bi bi-arrow-clockwise',
          shortcut: 'ctrl + Y',
          command: () => this.editor.chain().focus().redo().run(),
        },
      ];

      // Filter commands based on query (only filter non-separator commands)
      const lowerQuery = query.toLowerCase();
      const commands = query === ''
        ? allCommands
        : allCommands.filter((cmd: any) => {
          if (Object.keys(cmd).length === 0) return false; // Skip separators when filtering
          return cmd.title.toLowerCase().includes(lowerQuery);
        });

      const element = document.createElement('div');
      element.className = 'slash-commands';

      // Add inline styles for the container
      element.style.cssText = `
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
        padding: 8px;
        min-width: 280px;
        max-height: 400px;
        overflow-y: auto;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;

      // Show "no results" message if no commands match
      if (commands.length === 0) {
        const noResults = document.createElement('div');
        noResults.style.cssText = `
          padding: 16px;
          text-align: center;
          color: #9b9b9b;
          font-size: 14px;
        `;
        noResults.textContent = 'No matching commands';
        element.appendChild(noResults);
      }

      let isFirstItem = true;
      commands.forEach((cmd: any, index) => {
        if (Object.keys(cmd).length === 0) {
          // Only add separator if we're not filtering
          if (query === '') {
            const separator = document.createElement('div');
            separator.style.cssText = `
              height: 1px;
              background: #e5e5e5;
              margin: 8px 0;
            `;
            element.appendChild(separator);
          }
        } else {
          const button = document.createElement('button');
          // Select the first actual command item
          const isSelected = isFirstItem;
          isFirstItem = false;
          button.className = `slash-command-item ${isSelected ? 'selected_list_menu' : ''}`;
          button.style.cssText = `
            display: flex;
            align-items: center;
            width: 100%;
            padding: 10px 12px;
            border: none;
            background: ${isSelected ? '#f0f0f0' : 'transparent'};
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            color: #37352f;
            text-align: left;
            transition: background 0.15s ease;
          `;

          // Create icon element
          const iconSpan = document.createElement('span');
          iconSpan.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            background: linear-gradient(135deg, #3c76f5 0%, #1d47a3 100%);
            border-radius: 6px;
            margin-right: 12px;
            color: white;
            font-size: 14px;
          `;
          iconSpan.innerHTML = `<i class='${cmd.icon}'></i>`;

          // Create text container
          const textContainer = document.createElement('div');
          textContainer.style.cssText = `flex: 1;`;

          const title = document.createElement('div');
          title.style.cssText = `font-weight: 500; color: #37352f;`;
          title.textContent = cmd.title;

          textContainer.appendChild(title);

          // Create shortcut element
          const shortcutSpan = document.createElement('span');
          shortcutSpan.style.cssText = `
            font-size: 11px;
            color: #9b9b9b;
            background: #f5f5f5;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: monospace;
          `;
          if (cmd.shortcut) {
            shortcutSpan.textContent = cmd.shortcut;
          }

          button.appendChild(iconSpan);
          button.appendChild(textContainer);
          if (cmd.shortcut) {
            button.appendChild(shortcutSpan);
          }

          // Add hover effect
          button.addEventListener('mouseenter', () => {
            button.style.background = '#f0f0f0';
          });
          button.addEventListener('mouseleave', () => {
            if (!button.classList.contains('selected_list_menu')) {
              button.style.background = 'transparent';
            }
          });

          // Store the command and range info for the click handler
          const pluginState = plugin.getState(view.state);
          button.addEventListener('click', () => {
            // Delete the slash and any query text
            if (pluginState?.range) {
              view.dispatch(view.state.tr.deleteRange(pluginState.range.from, pluginState.range.to));
            }
            cmd.command();
            hideSuggestions();
          });
          element.appendChild(button);
        }
      });

      const coords = view.coordsAtPos($from.pos);

      if (!tippyInstance) {
        tippyInstance = tippy(document.body, {
          getReferenceClientRect: () => ({
            width: 0,
            height: 0,
            top: coords.top,
            bottom: coords.bottom,
            left: coords.left,
            right: coords.right,
            x: coords.left,
            y: coords.top,
            toJSON: () => '',
          }),
          appendTo: () => document.body,
          content: element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
        });
      } else {
        tippyInstance.setProps({
          getReferenceClientRect: () => ({
            width: 0,
            height: 0,
            top: coords.top,
            bottom: coords.bottom,
            left: coords.left,
            right: coords.right,
            x: coords.left,
            y: coords.top,
            toJSON: () => '',
          }),
          content: element,
        });
      }

      tippyInstance.show();
    };

    function hideSuggestions() {
      if (tippyInstance) {
        tippyInstance.hide();
      }
    }

    function handleMenuNavigation(event: KeyboardEvent, view: EditorView, range: { from: number; to: number } | null) {
      const items = document.querySelectorAll('.slash-command-item');
      if (items.length === 0) return;

      const selectedItem = document.querySelector('.slash-command-item.selected_list_menu');
      const selectedIndex = Array.from(items).indexOf(selectedItem as Element);

      if (event.key === 'Enter') {
        // If there's a selected item, click it. Otherwise, click the first item.
        const itemToClick = selectedItem || items[0];
        if (itemToClick) {
          (itemToClick as HTMLElement).click();
        }
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        // Calculate next index, handling case where nothing is selected
        const currentIndex = selectedIndex === -1 ? 0 : selectedIndex;
        const newIndex =
          event.key === 'ArrowDown'
            ? (currentIndex + 1) % items.length
            : (currentIndex - 1 + items.length) % items.length;

        // Update selection styling
        items.forEach((item, index) => {
          const isNowSelected = index === newIndex;
          item.classList.toggle('selected_list_menu', isNowSelected);
          (item as HTMLElement).style.background = isNowSelected ? '#f0f0f0' : 'transparent';
        });

        // Scroll the menu to the selected item
        const selectedElement = items[newIndex] as HTMLElement;
        if (selectedElement && selectedElement.parentElement) {
          const menuElement = selectedElement.parentElement;
          const menuHeight = menuElement.offsetHeight;
          const itemHeight = selectedElement.offsetHeight;
          const itemTop = selectedElement.offsetTop - menuElement.offsetTop;
          const itemBottom = itemTop + itemHeight;

          if (itemTop < menuElement.scrollTop) {
            menuElement.scrollTop = itemTop;
          } else if (itemBottom > menuElement.scrollTop + menuHeight) {
            menuElement.scrollTop = itemBottom - menuHeight;
          }
        }
      }
    }

    return [plugin];
  },
});
