/**
 * Streaming a provider's finished file into Storage (specs/ai-media-spec.md, AM-D12, AM-D28):
 * https only, a listed and public host on every hop, never with a key, stopped at the cap
 * with the part written taken away. The bucket and fetch are fakes.
 */
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ written: new Map<string, Buffer>(), deleted: [] as string[] }));

vi.mock('../init', () => ({
    db: {},
    owner: {},
    storage: {
        bucket: () => ({
            file: (path: string) => ({
                createWriteStream: () => {
                    const parts: Buffer[] = [];
                    return new Writable({
                        write(chunk: Buffer, _enc, done) { parts.push(Buffer.from(chunk)); done(); },
                        final(done) { h.written.set(path, Buffer.concat(parts)); done(); },
                    });
                },
                delete: async () => void h.deleted.push(path),
            }),
        }),
    },
}));

import { streamToStorage } from '../ai/files.js';

const meta = { contentType: 'video/mp4', recordId: 'r1', purpose: 'clip' };
const HOSTS = ['.klingai.com'];

function fakeFetch(...answers: Array<Response>): Array<{ url: string; init: RequestInit }> {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => (calls.push({ url, init }), answers.shift() ?? new Response(null, { status: 500 }))));
    return calls;
}

afterEach(() => {
    vi.unstubAllGlobals();
    h.written.clear();
    h.deleted = [];
});

describe('streamToStorage', () => {
    it('streams the file into the bucket through a checked redirect, without a key', async () => {
        const calls = fakeFetch(
            new Response(null, { status: 302, headers: { location: 'https://cdn.klingai.com/v.mp4?sig=1' } }),
            new Response(Buffer.from('video-bytes'), { status: 200, headers: { 'content-type': 'video/mp4' } }),
        );
        expect(await streamToStorage('https://s15-kling.klingai.com/v.mp4', HOSTS, 'ai-files/clip/v.mp4', meta, 5000)).toEqual({ ok: true, bytes: 11, contentType: 'video/mp4' });
        expect(h.written.get('ai-files/clip/v.mp4')?.toString()).toBe('video-bytes');
        expect(calls.map((c) => c.url)).toEqual(['https://s15-kling.klingai.com/v.mp4', 'https://cdn.klingai.com/v.mp4?sig=1']);
        expect(calls.every((c) => c.init.headers === undefined)).toBe(true);
    });

    it('refuses another host, plain http, credentials in the address and a redirect away', async () => {
        fakeFetch();
        expect(await streamToStorage('https://evil.example.com/v.mp4', HOSTS, 'p', meta, 5000)).toMatchObject({ ok: false, failure: 'unreadable' });
        expect(await streamToStorage('http://s15-kling.klingai.com/v.mp4', HOSTS, 'p', meta, 5000)).toMatchObject({ ok: false, failure: 'unreadable' });
        expect(await streamToStorage('https://user:pw@s15-kling.klingai.com/v.mp4', HOSTS, 'p', meta, 5000)).toMatchObject({ ok: false, failure: 'unreadable' });
        fakeFetch(new Response(null, { status: 302, headers: { location: 'https://metadata.google.internal/x' } }));
        expect(await streamToStorage('https://s15-kling.klingai.com/v.mp4', ['.klingai.com', 'metadata.google.internal'], 'p', meta, 5000)).toMatchObject({ ok: false, failure: 'unreadable' });
        expect(h.written.size).toBe(0);
    });

    it('stops at the cap, by the length given or the bytes read, and takes the part written away', async () => {
        fakeFetch(new Response(Buffer.alloc(10), { status: 200, headers: { 'content-length': '999999' } }));
        expect(await streamToStorage('https://s15-kling.klingai.com/v.mp4', HOSTS, 'p1', meta, 5000, 100)).toMatchObject({ ok: false, failure: 'too-large' });
        fakeFetch(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(80)); c.enqueue(new Uint8Array(80)); c.close(); } }), { status: 200 }));
        expect(await streamToStorage('https://s15-kling.klingai.com/v.mp4', HOSTS, 'p2', meta, 5000, 100)).toMatchObject({ ok: false, failure: 'too-large' });
        expect(h.deleted).toContain('p2');
    });

    it('says a provider\'s refusal or outage in the connectors\' words', async () => {
        fakeFetch(new Response('gone', { status: 404 }));
        expect(await streamToStorage('https://s15-kling.klingai.com/v.mp4', HOSTS, 'p', meta, 5000)).toMatchObject({ ok: false, failure: 'unreadable' });
        fakeFetch(new Response('down', { status: 503 }));
        expect(await streamToStorage('https://s15-kling.klingai.com/v.mp4', HOSTS, 'p', meta, 5000)).toMatchObject({ ok: false, failure: 'unavailable' });
    });
});
