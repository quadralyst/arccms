import { Injectable, inject } from '@angular/core';
import { injectT } from '../../../core/i18n/inject-t';
import { NotifyService } from '../../../../shared/services/notify.service';
import { plainText, type Change } from '../../../core/editing/compare';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { ReviewService, sameChanges } from '../hold/review.service';
import { pageValuesHaveReplace } from './page-text-editor.model';
import type { ReviewCard } from '../hold/review-changes-dialog.component';
import type { PageEditorData } from './page-editor-data';

export interface PageReviewScreen {
    /** Saves what is still typed; false when it could not. */
    flush: () => Promise<boolean>;
    /** Publishes the page's words, and the cards chosen. */
    publish: (cards: ReviewCard[]) => Promise<void> | void;
    /** The cards the page's holder changed on it are this person's from here. */
    takeCards?: (cards: ReviewCard[]) => Promise<void>;
    /** Shows a change's place on the screen. */
    show: (change: Change) => void;
    cards?: ReviewCard[];
    /** A draft was kept: History reads them again. */
    kept?: () => void;
}

/** Review changes of a page (specs/visual-editing-spec.md, VE-D80, VE-D81), for both of its editors. */
@Injectable({ providedIn: 'root' })
export class PageReview {
    private review = inject(ReviewService);
    private notify = inject(NotifyService);
    private confirm = inject(ConfirmService);
    private t = injectT();

    async open(data: PageEditorData, title: string, screen: PageReviewScreen): Promise<void> {
        const session = data.session;
        if (!session) return;
        const hold = data.heldBy();
        const cards = screen.cards ?? [];
        const answer = await this.review.open({
            title, hold, isNew: false, cards,
            load: async () => {
                if (!hold && !(await screen.flush())) throw new Error('What is typed could not be saved.');
                return session.changes().map((change) => this.withFileWords(data, change));
            },
            label: (change) => this.label(data, change),
            language: (code) => data.languages().find((l) => l.code === code)?.label || code,
            emptyText: this.t('admin.hold.from_file'),
            putBack: hold ? undefined : (change) => session.putBack(change),
            canDiscard: !hold,
        });
        if (!answer) return;
        if (answer.action === 'show') return screen.show(answer.change);
        if (answer.action !== 'discard') {
            // What was reviewed is what goes: someone else since, or another change, is looked at first.
            const now = session.changes().map((change) => this.withFileWords(data, change));
            if (data.heldBy()?.by !== hold?.by || !sameChanges(now, answer.seen)) {
                this.notify.info('admin.hold.changed_since');
                return this.open(data, title, screen);
            }
        }
        if (answer.action === 'publish') {
            if (hold && pageValuesHaveReplace(session.draft()) && !(await this.confirm.ask({
                titleKey: 'admin.contents.editor.replace_prompt_title',
                dialogMessage: this.t('admin.contents.editor.replace_prompt_confirm'),
                btnText: this.t('admin.contents.editor.publish_anyway'),
            }))) return;
            return screen.publish(cards.filter((card) => card.take));
        }
        if (answer.action === 'takeover') {
            if (!hold || !(await this.review.askTakeOver(hold))) return;
            try {
                if (!(await session.takeOver(hold.by))) {
                    this.notify.info('admin.hold.changed_since');
                    return;
                }
                await screen.takeCards?.(cards.filter((card) => card.take));
                screen.kept?.();
                this.notify.success('admin.hold.taken');
            } catch (error) {
                console.error('[PageReview] Could not take over:', error);
                this.notify.error('admin.hold.take_over_failed');
            }
            return;
        }
        if (!(await this.review.askDiscard())) return;
        try {
            await session.discard();
            screen.kept?.();
            this.notify.success('admin.hold.discarded');
        } catch (error) {
            console.error('[PageReview] Could not discard:', error);
            this.notify.error('admin.hold.discard_failed');
        }
    }

    /** Where the page shows its file's own words, the list says them, not nothing. */
    private withFileWords(data: PageEditorData, change: Change): Change {
        if (change.before && change.after) return change;
        const own = this.fileWords(data, change);
        return own ? { ...change, before: change.before || own, after: change.after || own } : change;
    }

    private fileWords(data: PageEditorData, change: Change): string {
        const file = data.files()[change.lang || data.defaultLang()] ?? data.files()[data.defaultLang()];
        if (!file) return '';
        // A list page's SEO words have none of their own: its title and summary show (VE-D69).
        if (change.field === 'seo:title') return data.isList ? '' : file.title;
        if (change.field === 'seo:description') return data.isList ? '' : file.description;
        const key = change.field.replace(/^(text|url):/, '');
        const area = file.areas.find((a) => a.key === key);
        if (!area) return data.isList && change.field === 'text:title' ? file.title : data.isList && change.field === 'text:intro' ? file.description : '';
        return change.field.startsWith('url:') ? area.fileUrl : plainText(area.fileText);
    }

    /** A change's name: the area's label, or the panel's own word for it. */
    label(data: PageEditorData, change: Change): string {
        if (change.field === 'shareImage') return this.t('admin.contents.editor.cover_image');
        if (change.field === 'seo:title') return this.t(data.isList ? 'admin.contents.editor.seo_title' : 'admin.contents.editor.title_label');
        if (change.field === 'seo:description') return this.t(data.isList ? 'admin.contents.editor.meta_description' : 'admin.contents.editor.summary');
        // A list page's heading and intro are its Title and Summary (VE-D60).
        if (data.isList && change.field === 'text:title') return this.t('admin.contents.editor.title_label');
        if (data.isList && change.field === 'text:intro') return this.t('admin.contents.editor.summary');
        const key = change.field.replace(/^(text|url):/, '');
        const area = data.sections().flatMap((section) => section.areas).find((view) => view.area.key === key)?.area;
        return area?.label || key.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
    }
}
