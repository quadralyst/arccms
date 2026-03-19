import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';

export interface YouTubeOptions {
  HTMLAttributes: Record<string, any>;
  controls: boolean;
  nocookie: boolean;
}

export const YouTubeExt = Node.create<YouTubeOptions>({
  name: 'youtube',

  addOptions() {
    return {
      HTMLAttributes: {},
      controls: false,
      nocookie: true,
      width: 480,
      height: 320,
      allowFullscreen: false,
      autoplay: true,
      ccLanguage: 'es',
      loop: true,
      progressBarColor: 'white',
    };
  },

  group: 'block',

  content: '',

  marks: '',

  selectable: false,

  atom: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute('src'),
        renderHTML: (attributes) => {
          if (!attributes['src']) {
            return {};
          }

          let src = attributes['src'];

          // Apply nocookie option
          if (this.options.nocookie) {
            src = src.replace('youtube.com', 'youtube-nocookie.com');
          }

          // Apply controls option
          if (!this.options.controls) {
            src += (src.includes('?') ? '&' : '?') + 'controls=0';
          }

          return {
            src,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'iframe[src^="https://www.youtube.com/embed/"], iframe[src^="https://www.youtube-nocookie.com/embed/"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      { class: 'youtube-video-wrapper' },
      [
        'iframe',
        mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
          width: '560',
          height: '315',
          frameborder: '0',
          allowfullscreen: 'true',
        }),
      ],
    ];
  },

  // addCommands() {
  //   return {
  //     setYoutubeVideo:
  //       (options: any) =>
  //       ({ commands }) => {
  //         return commands.insertContent({
  //           type: this.name,
  //           attrs: options,
  //         });
  //       },
  //   };
  // },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('youtube'),
        props: {
          handlePaste(view, event, slice) {
            const text = event.clipboardData?.getData('text/plain');
            const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(.+)/;
            const match = text?.match(youtubeRegex);

            if (match) {
              const [, videoId] = match;
              const youtubeEmbedUrl = `https://www.youtube.com/embed/${videoId}`;

              view.dispatch(
                view.state.tr.replaceSelectionWith(view.state.schema.nodes['youtube'].create({ src: youtubeEmbedUrl })),
              );

              return true;
            }

            return false;
          },
        },
      }),
    ];
  },
});
