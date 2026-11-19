import type { PageTextDraft } from '../../../core/site/page-text.service';
import type { PageTextEntry } from '../../../core/utils/page-text-model';
import type { PageCardBlock, PageFile, PageTextArea } from '../../../core/utils/page-text-areas';

/**
 * What the classic editor of a page shows for each area in one language
 * (specs/visual-editing-spec.md, VE-D43 to VE-D47, VE-D50): pure, so the
 * language order and the notes are tested apart from the screen.
 */

export interface EditorContext {
    lang: string;
    defaultLang: string;
    /** Whether `lang` is the default language or has a file of its own (`home.{lang}.html`). */
    ownFile: boolean;
    /** The file this language's page is built from. */
    file: PageFile;
    /** The default language's file. */
    defaultFile: PageFile;
    /** This language's `data-arc-t` strings ({} for the default language or a language with its own file). */
    strings: Record<string, string>;
    draft: PageTextDraft | null;
}

const usable = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** One area as the editor shows it in one language. */
export interface AreaView {
    area: PageTextArea;
    /** Whether it has words to edit (not a background, not a link that only holds an icon). */
    hasWords: boolean;
    /** The words saved for this language, '' when none. */
    words: string;
    /** What the page shows when nothing is saved for this language: the field's faint placeholder. */
    wordsFallback: string;
    /** The file's words, saved with a value so a later change to the file can be told (VE-D45). */
    fileWords: string;
    /** In another language: the default language's words, shown above the field (VE-D44). */
    defaultWords: string;
    /** The file's words changed since this language's value was saved (VE-D45). */
    wordsFileChanged: boolean;
    /** The default language's words changed since this translation was saved (VE-D44). */
    checkTranslation: boolean;
    /** Whether it has an address to edit (a picture, a link, a background). */
    hasUrl: boolean;
    /** The address saved, '' when none; the same in every language. */
    url: string;
    /** The file's address. */
    fileUrl: string;
    /** The file's address changed since the saved one was chosen (VE-D45). */
    urlFileChanged: boolean;
}

/** The area's entry in a language. */
function wordsEntry(draft: PageTextDraft | null, lang: string, key: string): PageTextEntry | undefined {
    return draft?.text?.[lang]?.[key];
}

/** The default language's words of an area: its saved value, else its file's. */
export function defaultWordsOf(key: string, ctx: Pick<EditorContext, 'draft' | 'defaultLang' | 'defaultFile'>): string {
    const saved = wordsEntry(ctx.draft, ctx.defaultLang, key)?.value;
    if (usable(saved)) return saved;
    return ctx.defaultFile.areas.find((area) => area.key === key)?.fileText ?? '';
}

/** One area in one language (VE-D43 to VE-D45). */
export function areaView(area: PageTextArea, ctx: EditorContext): AreaView {
    const entry = wordsEntry(ctx.draft, ctx.lang, area.key);
    const urlEntry = ctx.draft?.urls?.[area.key];
    const hasWords = area.kind !== 'background' && !(area.kind === 'link' && area.addressOnly);
    const hasUrl = area.kind === 'picture' || area.kind === 'link' || area.kind === 'background';
    const isDefault = ctx.lang === ctx.defaultLang;
    const defaultWords = isDefault ? '' : defaultWordsOf(area.key, ctx);

    let wordsFallback = area.fileText;
    if (!ctx.ownFile) {
        const translation = area.stringKey ? ctx.strings[area.stringKey] : undefined;
        const defaultSaved = wordsEntry(ctx.draft, ctx.defaultLang, area.key)?.value;
        wordsFallback = usable(translation) ? translation : usable(defaultSaved) ? defaultSaved : area.fileText;
    }

    return {
        area, hasWords, hasUrl,
        words: usable(entry?.value) ? entry!.value : '',
        wordsFallback,
        fileWords: area.fileText,
        defaultWords,
        wordsFileChanged: !!entry && typeof entry.fileText === 'string' && entry.fileText !== area.fileText,
        checkTranslation: !isDefault && !!entry && typeof entry.sourceText === 'string' && entry.sourceText !== defaultWords,
        url: usable(urlEntry?.value) ? urlEntry!.value : '',
        fileUrl: area.fileUrl,
        urlFileChanged: !!urlEntry && typeof urlEntry.fileText === 'string' && urlEntry.fileText !== area.fileUrl,
    };
}

/** A section of the page with its areas and card blocks, in page order (VE-D50). */
export interface SectionView {
    index: number;
    label: string;
    areas: AreaView[];
    blocks: PageCardBlock[];
}

/** The page's areas and card blocks grouped by section, sections in page order, the rest last. */
export function sectionViews(ctx: EditorContext): SectionView[] {
    const sections = new Map<number, SectionView>();
    const sectionFor = (index: number, label: string) => {
        if (!sections.has(index)) sections.set(index, { index, label, areas: [], blocks: [] });
        return sections.get(index)!;
    };
    for (const area of ctx.file.areas) sectionFor(area.section.index, area.section.label).areas.push(areaView(area, ctx));
    for (const block of ctx.file.cardBlocks) sectionFor(block.section.index, block.section.label).blocks.push(block);
    return [...sections.values()].sort((a, b) => (a.index < 0 ? 1 : b.index < 0 ? -1 : a.index - b.index));
}

/** A saved key the page's files no longer mark (VE-D47), with what was saved. */
export interface GoneKey {
    key: string;
    /** A saved word value, the default language's first. */
    text: string;
    url: string;
}

/** Saved keys no file of the page marks any more (VE-D47); never shown on the page. */
export function goneKeys(draft: PageTextDraft | null, files: PageFile[], defaultLang: string): GoneKey[] {
    if (!draft) return [];
    const marked = new Set(files.flatMap((file) => file.areas.map((area) => area.key)));
    const keys = new Set<string>([
        ...Object.values(draft.text || {}).flatMap((byKey) => Object.keys(byKey || {})),
        ...Object.keys(draft.urls || {}),
    ]);
    return [...keys].filter((key) => !marked.has(key)).sort().map((key) => {
        const langs = [defaultLang, ...Object.keys(draft.text || {}).filter((l) => l !== defaultLang)];
        const text = langs.map((l) => draft.text?.[l]?.[key]?.value).find(usable) ?? '';
        return { key, text, url: draft.urls?.[key]?.value ?? '' };
    });
}

/** The SEO words of one language, as the SEO tab shows them (VE-D51). */
export interface SeoView {
    title: string;
    titleFallback: string;
    description: string;
    descriptionFallback: string;
    shareImage: string;
}

export function seoView(ctx: EditorContext): SeoView {
    const seo = (lang: string) => ctx.draft?.seo?.[lang];
    const fallback = (field: 'title' | 'description'): string => {
        const fromFile = field === 'title' ? ctx.file.title : ctx.file.description;
        if (ctx.ownFile) return fromFile;
        const key = field === 'title' ? ctx.file.titleStringKey : ctx.file.descriptionStringKey;
        const translation = key ? ctx.strings[key] : undefined;
        const defaultSaved = seo(ctx.defaultLang)?.[field]?.value;
        return usable(translation) ? translation : usable(defaultSaved) ? defaultSaved : fromFile;
    };
    const own = (field: 'title' | 'description') => {
        const value = seo(ctx.lang)?.[field]?.value;
        return usable(value) ? value : '';
    };
    return {
        title: own('title'), titleFallback: fallback('title'),
        description: own('description'), descriptionFallback: fallback('description'),
        shareImage: usable(ctx.draft?.shareImage?.value) ? ctx.draft!.shareImage!.value : '',
    };
}
