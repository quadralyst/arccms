import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import tippy, { Instance } from 'tippy.js';

interface EmojiPluginState {
  active: boolean;
  range: { from: number; to: number } | null;
}

export const EmojiKey = new PluginKey<EmojiPluginState>('emoji');

export const EmojiExtension = Extension.create({
  name: 'emoji',

  addProseMirrorPlugins() {
    let tippyInstance: Instance | null = null;

    const plugin = new Plugin({
      key: EmojiKey,

      state: {
        init() {
          return { active: false, range: null };
        },
        apply(tr, prev: EmojiPluginState) {
          const { selection } = tr;
          const { $from } = selection;
          const currentLineText = $from.parent.textContent;
          const currentLinePos = $from.parentOffset;

          if (currentLineText[currentLinePos - 1] === ':') {
            return { active: true, range: { from: $from.pos - 1, to: $from.pos } };
          }

          if (prev.active && (!currentLineText.includes(':') || currentLinePos === 0)) {
            return { active: false, range: null };
          }

          return prev;
        },
      },

      view(editorView) {
        return {
          update: (view, prevState) => {
            const pluginState = plugin.getState(view.state);
            const prevPluginState = plugin.getState(prevState);

            if (pluginState?.active && !prevPluginState?.active) {
              showEmojiSuggestions(view);
            } else if (!pluginState?.active && prevPluginState?.active) {
              hideEmojiSuggestions();
            }
          },
          destroy: () => {
            hideEmojiSuggestions();
          },
        };
      },

      props: {
        handleKeyDown(view, event) {
          const pluginState = plugin.getState(view.state);
          if (!pluginState?.active) return false;

          if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Enter') {
            event.preventDefault();
            handleEmojiNavigation(event);
            return true;
          }

          return false;
        },
      },
    });

    const showEmojiSuggestions = (view: EditorView) => {
      const { state } = view;
      const { selection } = state;
      const { $from } = selection;

      const emojis = [
        { name: 'smile', emoji: '😊' },
        { name: 'laugh', emoji: '😂' },
        { name: 'heart', emoji: '❤️' },
        { name: 'thumbsup', emoji: '👍' },
        { name: 'fire', emoji: '🔥' },
        { name: 'clap', emoji: '👏' },
        { name: 'party', emoji: '🥳' },
        { name: 'cool', emoji: '😎' },
        { name: 'star', emoji: '⭐' },
        { name: 'rocket', emoji: '🚀' },
        { name: 'cry', emoji: '😢' },
        { name: 'angry', emoji: '😠' },
        { name: 'thinking', emoji: '🤔' },
        { name: 'pray', emoji: '🙏' },
        { name: 'sun', emoji: '☀️' },
        { name: 'moon', emoji: '🌙' },
        { name: 'earth', emoji: '🌍' },
        { name: 'coffee', emoji: '☕' },
        { name: 'cake', emoji: '🍰' },
        { name: 'gift', emoji: '🎁' },
        { name: 'music', emoji: '🎵' },
        { name: 'rainbow', emoji: '🌈' },
        { name: 'cat', emoji: '🐱' },
        { name: 'dog', emoji: '🐶' },
        { name: 'alien', emoji: '👽' },
        { name: 'robot', emoji: '🤖' },
        { name: 'unicorn', emoji: '🦄' },
        { name: 'balloon', emoji: '🎈' },
        { name: 'trophy', emoji: '🏆' },
        { name: 'checkmark', emoji: '✅' },
        { name: 'pencil', emoji: '✏️' },
        { name: 'lightbulb', emoji: '💡' },
        { name: 'book', emoji: '📖' },
        { name: 'telephone', emoji: '☎️' },
        { name: 'envelope', emoji: '✉️' },
        { name: 'camera', emoji: '📷' },
        { name: 'microphone', emoji: '🎤' },
        { name: 'soccer', emoji: '⚽' },
        { name: 'basketball', emoji: '🏀' },
        { name: 'football', emoji: '🏈' },
        { name: 'baseball', emoji: '⚾' },
        { name: 'tennis', emoji: '🎾' },
        { name: 'volleyball', emoji: '🏐' },
        { name: 'medal', emoji: '🥇' },
        { name: 'boxing_glove', emoji: '🥊' },
        { name: 'skull', emoji: '💀' },
        { name: 'ghost', emoji: '👻' },
        { name: 'poop', emoji: '💩' },
        { name: 'ninja', emoji: '🥷' },
        { name: 'pirate', emoji: '🏴‍☠️' },
        { name: 'snowman', emoji: '⛄' },
        { name: 'santa', emoji: '🎅' },
        { name: 'gift_box', emoji: '🎁' },
        { name: 'money', emoji: '💵' },
        { name: 'chart', emoji: '📊' },
        { name: 'magnifying_glass', emoji: '🔍' },
        { name: 'computer', emoji: '💻' },
        { name: 'keyboard', emoji: '⌨️' },
        { name: 'mouse', emoji: '🖱️' },
        { name: 'tv', emoji: '📺' },
        { name: 'game_controller', emoji: '🎮' },
        { name: 'tada', emoji: '🎉' },
        { name: 'hourglass', emoji: '⏳' },
        { name: 'bomb', emoji: '💣' },
        { name: 'lightning', emoji: '⚡' },
        { name: 'umbrella', emoji: '☂️' },
        { name: 'snowflake', emoji: '❄️' },
        { name: 'crown', emoji: '👑' },
        { name: 'ring', emoji: '💍' },
        { name: 'diamond', emoji: '💎' },
        { name: 'apple', emoji: '🍎' },
        { name: 'banana', emoji: '🍌' },
        { name: 'grapes', emoji: '🍇' },
        { name: 'watermelon', emoji: '🍉' },
        { name: 'peach', emoji: '🍑' },
        { name: 'cherries', emoji: '🍒' },
        { name: 'pineapple', emoji: '🍍' },
        { name: 'avocado', emoji: '🥑' },
        { name: 'carrot', emoji: '🥕' },
        { name: 'corn', emoji: '🌽' },
        { name: 'pizza', emoji: '🍕' },
        { name: 'hamburger', emoji: '🍔' },
        { name: 'fries', emoji: '🍟' },
        { name: 'hotdog', emoji: '🌭' },
        { name: 'spaghetti', emoji: '🍝' },
        { name: 'sushi', emoji: '🍣' },
        { name: 'icecream', emoji: '🍦' },
        { name: 'donut', emoji: '🍩' },
        { name: 'beer', emoji: '🍺' },
        { name: 'wine', emoji: '🍷' },
        { name: 'champagne', emoji: '🍾' },
        { name: 'martini', emoji: '🍸' },
        { name: 'cocktail', emoji: '🍹' },
        { name: 'money_bag', emoji: '💰' },
        { name: 'piggy_bank', emoji: '🐷' },
        { name: 'bank', emoji: '🏦' },
        { name: 'hospital', emoji: '🏥' },
        { name: 'school', emoji: '🏫' },
        { name: 'church', emoji: '⛪' },
        { name: 'train', emoji: '🚆' },
        { name: 'car', emoji: '🚗' },
        { name: 'airplane', emoji: '✈️' },
        { name: 'ship', emoji: '🚢' },
      ];

      const element = document.createElement('div');
      element.className = 'emoji-suggestions';
      emojis.forEach((emojiItem, index) => {
        const button = document.createElement('button');
        button.className = `emoji-item ${index === 0 ? 'selected' : ''}`;
        // button.innerHTML = `${emojiItem.emoji} :${emojiItem.name}:`;
        button.innerHTML = `${emojiItem.emoji}`;
        button.addEventListener('click', () => {
          insertEmoji(view, emojiItem.emoji);
          hideEmojiSuggestions();
        });
        element.appendChild(button);
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

    function hideEmojiSuggestions() {
      if (tippyInstance) {
        tippyInstance.hide();
      }
    }

    function handleEmojiNavigation(event: KeyboardEvent) {
      const items = document.querySelectorAll('.emoji-item');
      const selectedItem = document.querySelector('.emoji-item.selected');
      const selectedIndex = Array.from(items).indexOf(selectedItem as Element);

      if (event.key === 'Enter' && selectedItem) {
        (selectedItem as HTMLElement).click();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const newIndex =
          event.key === 'ArrowDown'
            ? (selectedIndex + 1) % items.length
            : (selectedIndex - 1 + items.length) % items.length;

        items.forEach((item, index) => {
          item.classList.toggle('selected', index === newIndex);
        });
      }
    }

    function insertEmoji(view: EditorView, emoji: string) {
      const { state } = view;
      const { selection } = state;
      const { $from } = selection;

      view.dispatch(view.state.tr.deleteRange($from.pos - 1, $from.pos).insertText(emoji, $from.pos - 1));
    }

    return [plugin];
  },
});
