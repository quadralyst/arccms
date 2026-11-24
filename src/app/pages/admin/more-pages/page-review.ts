import { Injectable, inject } from '@angular/core';
import { injectT } from '../../../core/i18n/inject-t';
import { NotifyService } from '../../../../shared/services/notify.service';
import { plainText, type Change } from '../../../core/editing/compare';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { ReviewService, sameChanges } from '../hold/review.service';
import { LIST_PAGE_KEYS, pageValuesHaveReplace } from './page-text-editor.model';
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
    /** The cards this person's Publish sends with the page, once what is typed is saved. */
    ownCards?: () => Promise<ReviewCard[]>;
    /** Opens a card's own panel. */
    showCard?: (card: ReviewCard) => void;
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
        const keys = (list: readonly ReviewCard[]) => list.map((card) => `${card.type}/${card.id}`).sort().join();
        let own: ReviewCard[] = [];
        const answer = await this.review.open({
            title, hold, isNew: false, cards,
            ownCards: hold || !screen.ownCards ? undefined : async () => (own = await screen.ownCards!()),
            load: async () => {
                if (!hold && !(await screen.flush())) throw new Error('What is typed could not be saved.');
                return this.listed(data);
            },
            label: (change) => this.label(data, change),
            language: (code) => data.languages().find((l) => l.code === code)?.label || code,
            emptyText: this.t('admin.hold.from_file'),
            putBack: hold ? undefined : (change) => session.putBack(change),
            canDiscard: !hold,
        });
        if (!answer) return;
        if (answer.action === 'show') return screen.show(answer.change);
        if (answer.action === 'card') return screen.showCard?.(answer.card);
        if (answer.action !== 'discard') {
            // What was reviewed is what goes: someone else since, or another change, is looked at first.
            const now = this.listed(data);
            // Another card joined them meanwhile (from another tab): not what was looked at.
            const others = !hold && screen.ownCards ? await screen.ownCards().then((list) => keys(list) !== keys(own), () => false) : false;
            if (data.heldBy()?.by !== hold?.by || others || !sameChanges(now, answer.seen)) {
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

    /** The changes as the list shows them: in the page's order, each area's languages together, then search and share. */
    private listed(data: PageEditorData): Change[] {
        const areas = data.sections().flatMap((section) => section.areas.map((view) => view.area.key));
        const langs = [data.defaultLang(), ...data.languages().map((l) => l.code)];
        const place = (change: Change): number[] => {
            const key = /^(text|url):/.test(change.field) ? change.field.replace(/^(text|url):/, '') : null;
            const lang = langs.indexOf(change.lang);
            if (key === null) return [1, change.field === 'shareImage' ? 1 : 0, lang, 0];
            // A list page's heading and intro come first, whether its file marks them or not (VE-D60).
            const first = data.isList ? LIST_PAGE_KEYS.indexOf(key) : -1;
            const at = areas.indexOf(key);
            return [0, first >= 0 ? first : LIST_PAGE_KEYS.length + (at < 0 ? areas.length : at), change.field.startsWith('url:') ? 1 : 0, lang];
        };
        return (data.session?.changes() ?? [])
            .map((change) => ({ change, place: place(change) }))
            .sort((a, b) => a.place.reduce((found, n, i) => found || n - b.place[i], 0))
            .map(({ change }) => this.withFileWords(data, change));
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
