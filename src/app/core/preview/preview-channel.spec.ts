import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    PreviewChannel, isPreviewUrl, parsePreviewMessage, previewChannelName, previewSessionKey, previewUrl,
    previewWindowName, resolvePreviewField, sessionKeyFromFragment, wrapPreviewMessage, PreviewMessage,
} from './preview-channel';

describe('preview channel messages (VE1.3)', () => {
    const roundTrip = (message: PreviewMessage) => parsePreviewMessage(JSON.parse(JSON.stringify(wrapPreviewMessage(message))));

    it('state: the draft, the language and the translation', () => {
        const message: PreviewMessage = { kind: 'state', draft: { id: 'a', title: 'T', customFields: { x: 1 } }, lang: 'hi', translation: { lang: 'hi', title: 'टी' } as any };
        expect(roundTrip(message)).toEqual(message);
        expect(roundTrip({ kind: 'state', draft: {}, lang: '', translation: null })).toEqual({ kind: 'state', draft: {}, lang: '', translation: null });
    });

    it('hello, highlight and bye', () => {
        expect(roundTrip({ kind: 'hello' })).toEqual({ kind: 'hello' });
        expect(roundTrip({ kind: 'highlight', key: 'title' })).toEqual({ kind: 'highlight', key: 'title' });
        expect(roundTrip({ kind: 'bye', from: 'editor' })).toEqual({ kind: 'bye', from: 'editor' });
        expect(roundTrip({ kind: 'bye', from: 'preview' })).toEqual({ kind: 'bye', from: 'preview' });
    });

    it('focus, with and without a row', () => {
        expect(roundTrip({ kind: 'focus', key: 'events-faq', row: 2 })).toEqual({ kind: 'focus', key: 'events-faq', row: 2 });
        expect(roundTrip({ kind: 'focus', key: 'title' })).toEqual({ kind: 'focus', key: 'title' });
    });

    it('ignores anything that is not ours, unknown or malformed', () => {
        const wrap = (message: unknown) => ({ protocol: 'arc-preview/1', message });
        for (const data of [
            null, 'hello', 42, [], { kind: 'hello' },
            { protocol: 'other/1', message: { kind: 'hello' } },
            wrap(null), wrap({ kind: 'nope' }), wrap({}),
            wrap({ kind: 'state', draft: 'x', lang: '' }), wrap({ kind: 'state', draft: {}, lang: 3 }),
            wrap({ kind: 'state', draft: {}, lang: '', translation: 'x' }), wrap({ kind: 'state', draft: [], lang: '' }),
            wrap({ kind: 'focus' }), wrap({ kind: 'focus', key: '' }), wrap({ kind: 'focus', key: 'a', row: -1 }),
            wrap({ kind: 'focus', key: 'a', row: 1.5 }), wrap({ kind: 'focus', key: 'x'.repeat(201) }),
            wrap({ kind: 'highlight', key: 7 }), wrap({ kind: 'bye', from: 'someone' }),
        ]) {
            expect(parsePreviewMessage(data), JSON.stringify(data)).toBeNull();
        }
    });

    it('keeps only the fields of a message, never extra ones', () => {
        expect(parsePreviewMessage({ protocol: 'arc-preview/1', message: { kind: 'hello', extra: '<b>' } })).toEqual({ kind: 'hello' });
    });
});

describe('preview window and session (VE-D5)', () => {
    it('one window name per entry, `new` before the first save', () => {
        expect(previewWindowName('events', 'abc')).toBe('arc-preview-events-abc');
        expect(previewWindowName('events', '')).toBe('arc-preview-events-new');
    });

    it('the address carries the key in its fragment, never in the path or query', () => {
        expect(previewUrl('events', 'abc', 'events.abc')).toBe('/admin/preview/events/abc#s=events.abc');
        expect(previewUrl('events', '', 'k 1')).toBe('/admin/preview/events/new#s=k%201');
    });

    it('a saved entry\'s key is its type and id; a new entry\'s is its own', () => {
        expect(previewSessionKey('events', 'abc')).toBe('events.abc');
        expect(previewSessionKey('events', '', () => 'r1')).toBe('events.new.r1');
        expect(previewSessionKey('events', '')).not.toBe(previewSessionKey('events', ''));
    });

    it('reads the key back from the fragment', () => {
        expect(sessionKeyFromFragment('#s=events.abc')).toBe('events.abc');
        expect(sessionKeyFromFragment('x=1&s=k%201')).toBe('k 1');
        expect(sessionKeyFromFragment('')).toBe('');
        expect(sessionKeyFromFragment(null)).toBe('');
        expect(sessionKeyFromFragment('#s=%E0%A4')).toBe('');
    });

    it('knows the preview\'s address', () => {
        expect(isPreviewUrl('/admin/preview/events/abc')).toBe(true);
        expect(isPreviewUrl('/admin/preview/events/new#s=x')).toBe(true);
        expect(isPreviewUrl('/admin/previews')).toBe(false);
        expect(isPreviewUrl('/admin/contents/events')).toBe(false);
        expect(isPreviewUrl('/events/preview')).toBe(false);
    });

    it('names the channel for the session', () => {
        expect(previewChannelName('events.abc')).toBe('arc-preview:events.abc');
    });
});

describe('PreviewChannel', () => {
    const channels: PreviewChannel[] = [];
    afterEach(() => channels.splice(0).forEach((c) => c.close()));

    it('delivers checked messages to the other window on the same key only', async () => {
        const editorGot = vi.fn();
        const otherGot = vi.fn();
        const preview = new PreviewChannel('k1', () => undefined);
        const editor = new PreviewChannel('k1', editorGot);
        const other = new PreviewChannel('k2', otherGot);
        channels.push(preview, editor, other);
        preview.post({ kind: 'focus', key: 'title' });
        await vi.waitFor(() => expect(editorGot).toHaveBeenCalledWith({ kind: 'focus', key: 'title' }));
        expect(otherGot).not.toHaveBeenCalled();
    });

    it('does nothing without a key, and a value that cannot be sent never throws', () => {
        const silent = new PreviewChannel('', () => undefined);
        expect(() => silent.post({ kind: 'hello' })).not.toThrow();
        const channel = new PreviewChannel('k3', () => undefined);
        channels.push(channel);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(() => channel.post({ kind: 'state', draft: { fn: () => 1 }, lang: '', translation: null })).not.toThrow();
        warn.mockRestore();
    });
});

describe('resolvePreviewField (VE-D8)', () => {
    const type = { slug: 'events', fields: [{ key: 'events-price' }, { key: 'events-faq' }, { key: 'events_brand' }, { key: 'events-cover_photo' }] };

    it('a custom field by its key or its unprefixed alias, either prefix', () => {
        expect(resolvePreviewField('events-price', type)).toEqual({ field: 'events-price', builtin: false });
        expect(resolvePreviewField('price', type)).toEqual({ field: 'events-price', builtin: false });
        expect(resolvePreviewField('brand', type)).toEqual({ field: 'events_brand', builtin: false });
        expect(resolvePreviewField('faq', type)).toEqual({ field: 'events-faq', builtin: false });
    });

    it('a derived binding finds the field it comes from', () => {
        expect(resolvePreviewField('brand_rgb_values', type)).toEqual({ field: 'events_brand', builtin: false });
        expect(resolvePreviewField('cover_photo_m', type)).toEqual({ field: 'events-cover_photo', builtin: false });
        expect(resolvePreviewField('faq_heading', type)).toEqual({ field: 'events-faq', builtin: false });
        expect(resolvePreviewField('coverImage_xl', type)).toEqual({ field: 'coverImage', builtin: true });
    });

    it('the entry\'s own fields', () => {
        expect(resolvePreviewField('title', type)).toEqual({ field: 'title', builtin: true });
        expect(resolvePreviewField('content', type)).toEqual({ field: 'content', builtin: true });
        expect(resolvePreviewField('tagsWithColors', type)).toEqual({ field: 'tags', builtin: true });
        expect(resolvePreviewField('authorName', type)).toEqual({ field: 'authorId', builtin: true });
    });

    it('nothing for what the site works out, a dotted key, or no type', () => {
        for (const key of ['publishedOn', 'date', 'readingTime', 'share.twitter', 'author.name', 'related', 'langPrefix', '']) {
            expect(resolvePreviewField(key, type), key).toBeNull();
        }
        expect(resolvePreviewField('title', null)).toBeNull();
    });
});
