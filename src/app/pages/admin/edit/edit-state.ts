import type { TranslationKey } from '../../../core/i18n/translation-keys';

/**
 * Where what is being edited stands (specs/visual-editing-spec.md, VE-D70), in the
 * same words and colours on every editor: an entry, an HTML page and a list page,
 * in the Visual Editor and the classic editors.
 *
 * - `saving`: a change is being saved, or is about to be
 * - `not_saved`: the last save failed
 * - `publishing`: waiting for the site
 * - `never`: saved, and never published
 * - `changes`: saved, and not what visitors see
 * - `published`: what visitors see
 */
export type EditState = 'saving' | 'not_saved' | 'publishing' | 'never' | 'changes' | 'published';

export interface EditStateInput {
    saving: boolean;
    failed: boolean;
    publishing: boolean;
    /** Saved changes the site does not have. */
    changed: boolean;
    /** It was published at least once, or is live from its file. */
    live: boolean;
}

/** The one state to show. A save under way comes first: what follows may change the answer. */
export function editState(input: EditStateInput): EditState {
    if (input.saving) return 'saving';
    if (input.failed) return 'not_saved';
    if (input.publishing) return 'publishing';
    if (!input.live) return 'never';
    return input.changed ? 'changes' : 'published';
}

export const EDIT_STATE_KEYS: Record<EditState, TranslationKey> = {
    saving: 'admin.edit_page.state.saving',
    not_saved: 'admin.edit_page.state.not_saved',
    publishing: 'admin.edit_page.state.publishing',
    never: 'admin.edit_page.state.never',
    changes: 'admin.edit_page.state.changes',
    published: 'admin.edit_page.state.published',
};
