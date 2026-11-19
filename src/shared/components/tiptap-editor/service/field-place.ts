/**
 * A custom field placed in the text (specs/visual-editing-spec.md, VE-D28).
 *
 * The field's content stays in the field; the text holds only a marker,
 * `<div data-arc-place="{field key}"></div>`, saying "the field shows here".
 * Publishing and the app's own pages move the template's block for that field
 * to the marker (core/utils/field-places.ts); without a marker the field shows
 * where the template puts it.
 *
 * In the editor the marker is a card: a "Field" tag and the field's name, what
 * the field holds (a few lines in the form editor, the field as drawn on the
 * Visual Editor), and Edit, which opens the field. One marker per field: placing
 * a field again moves its marker.
 */
import { Node } from '@tiptap/core';

/** The field types that show as a block of their own and can be placed in the text. */
export const PLACEABLE_FIELD_TYPES = ['faq', 'gallery', 'infocard', 'labelvalue', 'maplocation', 'image', 'file', 'richtext'] as const;

/** The marker's attribute: its value is the field's stored key. */
export const PLACE_ATTR = 'data-arc-place';

/** A field the editor can place. */
export interface PlaceableField {
    /** The stored key, slug prefix and all. */
    key: string;
    /** The field's name, as the form shows it. */
    label: string;
    type: string;
}

/** What the editor needs from the screen it is on to place fields. */
export interface FieldPlaces {
    /** This entry's fields that can be placed, in the form's order. */
    fields(): PlaceableField[];
    /** Opens the field where it is edited (the side panel, Page settings). */
    open(key: string): void;
    /** What the card shows: the field as drawn on the page, if the screen has it. */
    drawn?(key: string): Element | null;
    /** What the card shows otherwise: a few lines of the field's content, none when it is empty. */
    summary(key: string): string[];
    /** Words in the admin's language, from common.field_place keys. */
    translate(key: string, params?: Record<string, string>): string;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        fieldPlace: {
            /** Places the field at the cursor; one already in the text moves here. */
            placeField: (key: string) => ReturnType;
        };
    }
}

export interface FieldPlaceOptions {
    places: FieldPlaces | null;
}

export const FieldPlace = Node.create<FieldPlaceOptions>({
    name: 'fieldPlace',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,

    addOptions() {
        return { places: null };
    },

    addAttributes() {
        return {
            field: {
                default: '',
                parseHTML: (element) => element.getAttribute(PLACE_ATTR) ?? '',
                renderHTML: (attributes) => ({ [PLACE_ATTR]: attributes['field'] }),
            },
        };
    },

    parseHTML() {
        // Before the editor's plain `div` node, which would read the marker as an empty box.
        return [{ tag: `div[${PLACE_ATTR}]`, priority: 100 }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', HTMLAttributes];
    },

    addNodeView() {
        const places = () => this.options.places;
        return ({ node, view }) => {
            const key = String(node.attrs['field'] ?? '');
            // The editor's own document: the admin page, or the Visual Editor's frame. The view
            // is handed in: on the first draw the editor's own `view` is not there yet.
            const doc = view.dom.ownerDocument;
            addFieldPlaceStyle(doc);
            const dom = doc.createElement('div');
            dom.className = 'arc-field-place';
            dom.contentEditable = 'false';
            dom.setAttribute(PLACE_ATTR, key);
            drawCard(dom, key, places());
            return {
                dom,
                // The card is redrawn from the field each time the text changes around it.
                update: (updated) => {
                    if (updated.type.name !== 'fieldPlace' || updated.attrs['field'] !== key) return false;
                    drawCard(dom, key, places());
                    return true;
                },
                stopEvent: (event) => !!(event.target as HTMLElement | null)?.closest?.('button'),
                ignoreMutation: () => true,
            };
        };
    },

    addCommands() {
        return {
            placeField:
                (key) =>
                ({ state, tr, dispatch, chain }) => {
                    if (!key) return false;
                    // The field's marker already in the text goes: a field shows once.
                    const old: { from: number; to: number }[] = [];
                    state.doc.descendants((node, pos) => {
                        if (node.type.name === this.name && node.attrs['field'] === key) old.push({ from: pos, to: pos + node.nodeSize });
                    });
                    if (!dispatch) return true;
                    for (const range of old.reverse()) tr.delete(range.from, range.to);
                    return chain().insertContent({ type: this.name, attrs: { field: key } }).run();
                },
        };
    },
});

/** The card: the tag and name, what the field holds, and Edit. */
function drawCard(dom: HTMLElement, key: string, places: FieldPlaces | null): void {
    const document = dom.ownerDocument;
    const t = (k: string, params?: Record<string, string>) => places?.translate(`common.field_place.${k}`, params) ?? k;
    const field = places?.fields().find((f) => f.key === key);
    dom.replaceChildren();

    const head = document.createElement('div');
    head.className = 'arc-field-place-head';
    const tag = document.createElement('span');
    tag.className = 'arc-field-place-tag';
    tag.textContent = t('tag');
    const name = document.createElement('span');
    name.className = 'arc-field-place-name';
    name.textContent = field?.label ?? key;
    head.append(tag, name);
    if (field && places) {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'arc-field-place-edit';
        edit.textContent = t('edit');
        edit.addEventListener('mousedown', (event) => event.preventDefault());
        edit.addEventListener('click', (event) => {
            event.preventDefault();
            places.open(key);
        });
        head.append(edit);
    }
    dom.append(head);

    const body = document.createElement('div');
    body.className = 'arc-field-place-body';
    if (!field) {
        // A field the type no longer has: the marker shows nothing on the page.
        body.textContent = t('gone');
    } else {
        const drawn = places?.drawn?.(key);
        const lines = drawn ? [] : places?.summary(key) ?? [];
        if (drawn) {
            body.classList.add('arc-field-place-drawn');
            body.append(drawn);
        } else if (lines.length) {
            const list = document.createElement('ul');
            for (const line of lines) {
                const item = document.createElement('li');
                item.textContent = line;
                list.append(item);
            }
            body.append(list);
        } else {
            body.classList.add('arc-field-place-empty');
            body.textContent = t('empty');
        }
    }
    dom.append(body);
}

/** True when the type can be placed in the text. */
export function isPlaceable(type: string): boolean {
    return (PLACEABLE_FIELD_TYPES as readonly string[]).includes(type);
}

/** A few lines of what a field holds, for the card in the form editor; none when it is empty. */
export function fieldSummary(type: string, value: unknown, max = 5): string[] {
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const fileName = (url: string) => decodeURIComponent(url.split('?')[0].split('/').pop() ?? '');
    const rows = Array.isArray(value) ? value.filter((r) => r && typeof r === 'object') as Record<string, unknown>[] : [];
    let lines: string[] = [];
    switch (type) {
        case 'faq': lines = rows.map((r) => text(r['question'])); break;
        case 'infocard': lines = rows.map((r) => text(r['headline'])); break;
        case 'labelvalue': lines = rows.map((r) => [text(r['label']), text(r['value'])].filter(Boolean).join(': ')); break;
        case 'maplocation': lines = rows.map((r) => text(r['label']) || text(r['address'])); break;
        case 'gallery': lines = rows.map((r) => text(r['caption']) || fileName(text(r['image']) || text(r['video']))); break;
        case 'file': lines = rows.map((r) => text(r['title']) || fileName(text(r['url']))); break;
        case 'image': lines = [fileName(text(value))]; break;
        case 'richtext': {
            const plain = text(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            lines = [plain.length > 120 ? `${plain.slice(0, 117)}...` : plain];
            break;
        }
    }
    lines = lines.filter(Boolean);
    return lines.length > max ? [...lines.slice(0, max), `+${lines.length - max}`] : lines;
}

/**
 * The card's look, the same in the form editor (added to the admin page) and on the
 * Visual Editor (added to the page's frame). Outlines, not borders, so the card
 * takes no more room than the field drawn on the page.
 */
export const FIELD_PLACE_CSS = `
.arc-field-place { margin: 1em 0; outline: 1px dashed #94a3b8; outline-offset: 4px; border-radius: 6px; cursor: default; }
.arc-field-place.ProseMirror-selectednode { outline: 2px solid #334155; }
.arc-field-place-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font: 500 13px/1.4 system-ui, sans-serif; color: #334155; }
.arc-field-place-tag { padding: 1px 8px; border-radius: 999px; background: #e2e8f0; color: #334155; font-size: 12px; font-weight: 600; }
.arc-field-place-name { flex: 1 1 auto; font-weight: 600; }
.arc-field-place-edit { font: 500 13px/1.4 system-ui, sans-serif; color: #1e293b; background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 2px 10px; cursor: pointer; }
.arc-field-place-edit:hover { background: #f1f5f9; }
.arc-field-place-body { font: 14px/1.5 system-ui, sans-serif; color: #475569; }
.arc-field-place-body ul { margin: 0; padding-left: 1.2em; }
.arc-field-place-empty { font-style: italic; color: #94a3b8; }
.arc-field-place-drawn { font: inherit; color: inherit; pointer-events: none; }
`;

/** Adds the card's look to a document once. */
export function addFieldPlaceStyle(doc: Document | null | undefined): void {
    if (!doc || doc.getElementById('arc-field-place-style')) return;
    const style = doc.createElement('style');
    style.id = 'arc-field-place-style';
    style.textContent = FIELD_PLACE_CSS;
    (doc.head ?? doc.documentElement).appendChild(style);
}
