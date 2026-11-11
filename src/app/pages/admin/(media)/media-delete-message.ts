import { escapeHtml } from '../../../../shared/utils/escape-html';
import type { TranslationKey } from '../../../core/i18n/translation-keys';
import type { MediaUsage } from './media-manager.service';

type Translate = (key: TranslationKey, params?: Record<string, unknown>) => string;

/**
 * The body of the "delete this file?" question: the question itself, then
 * what the delete breaks. An image used in content leaves a broken image
 * there; a document leaves broken links. The admin can still delete.
 *
 * `usage` null: the check failed or was too slow, and the dialog says so
 * rather than claiming nothing uses it.
 */
export function mediaDeleteMessage(t: Translate, question: string, usage: MediaUsage | null, kind: 'image' | 'file'): string {
    const parts = [`<p>${question}</p>`];
    if (!usage) {
        parts.push(`<p>${escapeHtml(t('admin.media.usage_unknown'))}</p>`);
    } else if (usage.count > 0) {
        // `more`: the check stopped counting at its cap, so say "20 or more".
        const key: TranslationKey = kind === 'image'
            ? (usage.more ? 'admin.media.used_in_many' : usage.count === 1 ? 'admin.media.used_in_one' : 'admin.media.used_in')
            : (usage.more ? 'admin.media.files.linked_from_many' : usage.count === 1 ? 'admin.media.files.linked_from_one' : 'admin.media.files.linked_from');
        parts.push(`<p class="text-danger"><strong>${escapeHtml(t(key, { count: usage.count }))}</strong></p>`);
        const titles = usage.titles.filter(Boolean);
        if (titles.length) {
            const more = usage.more || usage.count > titles.length ? ', …' : '';
            parts.push(`<p>${titles.map(escapeHtml).join(', ')}${more}</p>`);
        }
    }
    return parts.join('');
}
