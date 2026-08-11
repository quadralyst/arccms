import { compileEmailDesign } from './compiler';
import { EmailDesign, IEmailBrandKit, DEFAULT_BRAND_KIT } from './email-design.model';

export interface NewEmailMeta {
    title: string;
    subject: string;
    category: 'transactional' | 'marketing';
}

/**
 * Starter block design for a freshly created email — a heading seeded with the
 * template title plus a placeholder paragraph, so a brand-new template compiles
 * to something visible instead of an empty body.
 */
export function starterEmailDesign(title: string): EmailDesign {
    return {
        blocks: [
            { id: 'h', type: 'heading', text: title?.trim() || 'New email', level: 1 },
            { id: 'p', type: 'paragraph', html: 'Start writing your email…' },
        ],
    };
}

/**
 * Firestore payload for a new `EmailTemplate` doc. Both the composer's
 * "New email" button and the drip drawer's inline "New email" create through
 * this so a template born in either place has the same shape: a unique `type`
 * (so template pickers never collapse it via dedupe-by-type), a starter design
 * and a pre-compiled `template` HTML. The composer passes the real brand kit;
 * the drip drawer falls back to {@link DEFAULT_BRAND_KIT} and the admin can
 * refine content later in the composer.
 */
export function buildNewEmailTemplate(
    meta: NewEmailMeta,
    uniqueSuffix: string | number,
    brandKit: IEmailBrandKit = DEFAULT_BRAND_KIT,
) {
    const design = starterEmailDesign(meta.title);
    return {
        type: 'custom_' + uniqueSuffix,
        title: meta.title?.trim() || 'Untitled email',
        subject: meta.subject?.trim() || '',
        category: meta.category,
        editorVersion: 'blocks' as const,
        design,
        template: compileEmailDesign(design, brandKit),
    };
}
