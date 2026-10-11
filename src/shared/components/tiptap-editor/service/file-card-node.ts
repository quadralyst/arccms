import { Node, mergeAttributes } from '@tiptap/core';
import { fileMeta, MediaFileRef, MediaFileType, MEDIA_FILE_TYPE_LABELS } from '../../../utils/file-rows';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fileCard: {
      /** Inserts a link card to a library file (docs/features/media.html, Files). */
      insertFileCard: (file: MediaFileRef) => ReturnType;
    };
  }
}

/** Only web links: a card is never a `javascript:` or `data:` link. */
export function safeFileHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * A file in rich text: a card linking to a library file (MF-D20). It is
 * stored as one link, so every sanitiser and the static pages keep it:
 *
 *   <a class="arc-file" data-arc-file="pdf" data-bytes="2411724" href="..." target="_blank" rel="noopener">
 *     <span class="arc-file-title">Annual Report 2025</span>
 *     <span class="arc-file-meta">PDF · 2.3 MB</span>
 *   </a>
 *
 * The site's base styles draw it as a card (`.arc-file`); a template can
 * restyle it. The card is built from the picked file's record, never typed.
 */
export const FileCard = Node.create({
  name: 'fileCard',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      href: { default: null },
      title: { default: '' },
      type: { default: 'pdf' },
      bytes: { default: 0 },
      pages: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a.arc-file[href]',
        // Before the Link mark, which would otherwise take it as a plain link.
        priority: 100,
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const href = safeFileHref(el.getAttribute('href'));
          if (!href) return false;
          const type = (el.getAttribute('data-arc-file') || 'pdf') as MediaFileType;
          return {
            href,
            type: type in MEDIA_FILE_TYPE_LABELS ? type : 'pdf',
            bytes: Number(el.getAttribute('data-bytes')) || 0,
            pages: Number(el.getAttribute('data-pages')) || null,
            title: el.querySelector('.arc-file-title')?.textContent?.trim() || el.textContent?.trim() || '',
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { href, title, type, bytes, pages } = node.attrs as { href: string; title: string; type: MediaFileType; bytes: number; pages: number | null };
    const attrs: Record<string, string> = {
      class: 'arc-file',
      'data-arc-file': type,
      'data-bytes': String(bytes || 0),
      href: safeFileHref(href) ?? '#',
      target: '_blank',
      rel: 'noopener',
    };
    if (pages) attrs['data-pages'] = String(pages);
    const { href: _h, title: _t, type: _ty, bytes: _b, pages: _p, ...rest } = HTMLAttributes;
    return [
      'a',
      mergeAttributes(rest, attrs),
      ['span', { class: 'arc-file-title' }, title || href],
      ['span', { class: 'arc-file-meta' }, fileMeta({ type, bytes, pages: pages ?? undefined })],
    ];
  },

  addCommands() {
    return {
      insertFileCard:
        (file) =>
        ({ commands }) => {
          const href = safeFileHref(file.url);
          if (!href) return false;
          return commands.insertContent({
            type: this.name,
            attrs: { href, title: file.title, type: file.type, bytes: file.bytes, pages: file.pages ?? null },
          });
        },
    };
  },
});
