import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, signal } from '@angular/core';

const fs = vi.hoisted(() => ({
    setDoc: vi.fn(async () => undefined),
    getDoc: vi.fn(async () => ({ data: () => ({ enabled: true }) })),
}));
const st = vi.hoisted(() => ({ uploadBytes: vi.fn(async () => undefined) }));

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class {},
    collection: vi.fn(() => 'feedback-collection'),
    doc: vi.fn((_parent: unknown, ...path: string[]) => ({ id: path.length ? path.join('/') : 'fb-1', path })),
    getDoc: fs.getDoc,
    setDoc: fs.setDoc,
    serverTimestamp: () => 'SERVER_TIME',
}));
vi.mock('@angular/fire/storage', () => ({
    Storage: class {},
    ref: vi.fn((_s: unknown, path: string) => ({ path })),
    uploadBytes: st.uploadBytes,
}));
vi.mock('@angular/fire/auth', () => ({ Auth: class {}, onIdTokenChanged: vi.fn() }));
vi.mock('../config/arc-config', () => ({ withStoragePrefix: (path: string) => `arccms/${path}` }));

import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
import { PwaService } from '../pwa/pwa.service';
import { FeedbackService } from './feedback.service';

function setup() {
    TestBed.configureTestingModule({
        providers: [
            { provide: PLATFORM_ID, useValue: 'browser' },
            { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
            { provide: Firestore, useValue: {} },
            { provide: Storage, useValue: {} },
            { provide: PwaService, useValue: { installed: signal(true) } },
        ],
    });
    const service = TestBed.inject(FeedbackService);
    service.userDocId.set('rec-1');
    return service;
}

describe('FeedbackService', () => {
    beforeEach(() => {
        TestBed.resetTestingModule();
        vi.clearAllMocks();
    });

    it('reads whether an admin turned the button on', async () => {
        const service = setup();
        await service.loadSetting();
        expect(service.enabled()).toBe(true);
        expect(service.available()).toBe(true);
    });

    it('uploads the files to the sender\'s own folder, then saves the feedback', async () => {
        const service = setup();
        await service.send({
            message: '  The lesson froze  ',
            screenshot: new Blob(['jpg'], { type: 'image/jpeg' }),
            voice: { blob: new Blob(['ogg']), type: 'audio/webm;codecs=opus', seconds: 7 },
        });

        const uploads = st.uploadBytes.mock.calls.map(([r, , meta]: any) => [r.path, meta.contentType]);
        expect(uploads).toEqual([
            ['arccms/users/rec-1/feedback/fb-1/screenshot.jpg', 'image/jpeg'],
            ['arccms/users/rec-1/feedback/fb-1/voice.webm', 'audio/webm'],
        ]);
        const [, saved] = fs.setDoc.mock.calls[0] as any;
        expect(saved).toMatchObject({
            uid: 'u1',
            userDocId: 'rec-1',
            message: 'The lesson froze',
            screenshotPath: 'arccms/users/rec-1/feedback/fb-1/screenshot.jpg',
            voicePath: 'arccms/users/rec-1/feedback/fb-1/voice.webm',
            voiceSeconds: 7,
            page: { path: '/' },
            device: { installed: true },
            status: 'new',
            createdAt: 'SERVER_TIME',
        });
    });

    it('sends text alone, with no file fields', async () => {
        const service = setup();
        await service.send({ message: 'Hello', screenshot: null, voice: null });
        expect(st.uploadBytes).not.toHaveBeenCalled();
        const [, saved] = fs.setDoc.mock.calls[0] as any;
        expect(saved).not.toHaveProperty('screenshotPath');
        expect(saved).not.toHaveProperty('voicePath');
    });

    it('still sends the words when the screenshot will not upload', async () => {
        const service = setup();
        st.uploadBytes.mockRejectedValueOnce(new Error('storage/unauthorized'));
        await service.send({ message: 'Hello', screenshot: new Blob(['jpg']), voice: null });
        const [, saved] = fs.setDoc.mock.calls[0] as any;
        expect(saved.message).toBe('Hello');
        expect(saved).not.toHaveProperty('screenshotPath');
    });

    it('refuses without a signed-in record', async () => {
        const service = setup();
        service.userDocId.set(null);
        await expect(service.send({ message: 'Hi', screenshot: null, voice: null })).rejects.toThrow();
        expect(fs.setDoc).not.toHaveBeenCalled();
    });
});
