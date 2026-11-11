/**
 * The Media Manager's Create with AI tab (specs/ai-media-spec.md, section 5, AM-D21 to
 * AM-D26): controls read from the chosen model, the estimate and limits before Generate,
 * test mode, results saved to the library with their "Made with AI" note, and Edit with AI.
 * The server is a fake MediaAiService.
 */
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { translocoTestingModule } from '../../../../../test/transloco-test-providers';
import { FileUploadService } from '../../../../../shared/services/file-upload.service';
import { MediaManagerStore } from '../media-manager.store';
import { MediaAiService, type MediaAiInfo, type MediaAiModel } from '../media-ai.service';
import { aspectForRatio, aspectOfSize, MediaAiTabComponent, resolutionForSize, type MediaAiSaved } from './media-ai-tab.component';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const OPENAI: MediaAiModel = {
    connection: 'openai', model: 'gpt-image-2', label: 'OpenAI', unit: 'pictures', testedLive: false,
    image: { aspects: ['1:1', '3:2', '2:3'], resolutions: ['standard', 'high'], qualities: ['low', 'medium', 'high'], maxCount: 4, edit: true, formats: ['png', 'webp'] },
};
const GEMINI: MediaAiModel = {
    connection: 'gemini', model: 'gemini-3.1-flash-image', label: 'Gemini', unit: 'pictures', testedLive: true,
    image: { aspects: ['1:1', '16:9', '9:16'], resolutions: ['standard'], maxCount: 4, formats: ['png'] },
};
const SEEDED: MediaAiModel = {
    connection: 'other', model: 'seeded', label: 'Other', unit: 'pictures', testedLive: true,
    image: { aspects: ['1:1'], resolutions: ['standard'], maxCount: 2, seed: true, negativePrompt: true, formats: ['jpeg'] },
};

function infoWith(over: Partial<MediaAiInfo> = {}): MediaAiInfo {
    return {
        purpose: { id: 'arc-media-image', label: 'Media image', enabled: true, house: false },
        test: false,
        models: [OPENAI, GEMINI, SEEDED],
        estimate: { usd: 0.212, about: false, priced: true, amount: 4, unit: 'pictures' },
        allowance: { perDay: 20, used: 4, left: 16 },
        budget: { monthlyUsd: 20, spent: 7.6, left: 12.4 },
        ...over,
    };
}

describe('MediaAiTabComponent', () => {
    let ai: { info: ReturnType<typeof vi.fn>; generate: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn>; available: ReturnType<typeof vi.fn> };
    let upload: { uploadFile: ReturnType<typeof vi.fn>; removeStored: ReturnType<typeof vi.fn> };
    let store: { addBatch: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        ai = {
            info: vi.fn(async () => infoWith()),
            generate: vi.fn(async () => ({
                ok: true, files: [{ path: 'ai-files/arc-media-image/2026-11/r1-1.webp', mimeType: 'image/webp', bytes: 10, width: 1024, height: 1024 }],
                recordId: 'r1', purpose: 'arc-media-image', model: { connection: 'openai', model: 'gpt-image-2' }, settings: { aspect: '1:1', quality: 'medium', count: 1 }, costUsd: 0.053, test: false,
            })),
            read: vi.fn(async () => new Blob(['img'], { type: 'image/webp' })),
            available: vi.fn(async () => true),
        };
        upload = {
            uploadFile: vi.fn(async () => ({ downloadURL: 'https://x/a-xl.webp', name: 'a.webp', uploadTime: new Date(), variants: {} })),
            removeStored: vi.fn(async () => undefined),
        };
        store = { addBatch: vi.fn(() => of(['media-1'])) };
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        TestBed.resetTestingModule();
    });

    async function render(inputs: Record<string, unknown> = {}) {
        TestBed.configureTestingModule({
            imports: [MediaAiTabComponent, translocoTestingModule()],
            providers: [
                { provide: MediaAiService, useValue: ai },
                { provide: FileUploadService, useValue: upload },
                { provide: MediaManagerStore, useValue: store },
            ],
        });
        const fixture = TestBed.createComponent(MediaAiTabComponent);
        fixture.componentRef.setInput('uploadSettings', { maxFileSize: 5, maxSize: 1200, convertToWebp: true });
        for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
        fixture.detectChanges();
        const flush = async () => {
            await settle();
            await settle();
            fixture.detectChanges();
        };
        await flush();
        return { fixture, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, flush };
    }

    it('starts from the picker\'s ratio and size', () => {
        expect(aspectForRatio('16:9')).toBe('16:9');
        expect(aspectForRatio('free')).toBe('1:1');
        expect(aspectForRatio('original')).toBe('1:1');
        expect(resolutionForSize('xl')).toBe('high');
        expect(resolutionForSize('m')).toBe('standard');
        // An edit starts at the picture's own shape.
        expect(aspectOfSize(1200, 674)).toBe('16:9');
        expect(aspectOfSize(800, 1200)).toBe('2:3');
        expect(aspectOfSize(undefined, 10)).toBeNull();
    });

    it('shows only the controls the chosen model takes, and keeps what was typed', async () => {
        const { c, el, flush } = await render({ cropRatio: '16:9', size: 'xl' });
        expect(c.aspect()).toBe('16:9');
        // OpenAI makes no 16:9: the nearest is said.
        expect(el.querySelector('#aiAspect')?.textContent).toContain('made at the nearest shape');
        expect(el.querySelector('#aiQuality')).not.toBeNull();
        expect(el.querySelector('#aiResolution')).not.toBeNull();
        expect(el.querySelector('.more-toggle')).toBeNull();
        c.prompt.set('A bowl of fruit');
        c.chooseModel('gemini/gemini-3.1-flash-image');
        await flush();
        expect(el.querySelector('#aiQuality')).toBeNull();
        expect(el.querySelector('#aiResolution')).toBeNull();
        expect(c.image()).toEqual({ aspect: '16:9', resolution: 'standard', count: 1 });
        c.chooseModel('other/seeded');
        c.moreOpen.set(true);
        await flush();
        expect(el.querySelector('#aiNegative')).not.toBeNull();
        expect(el.querySelector('#aiSeed')).not.toBeNull();
        expect(c.prompt()).toBe('A bowl of fruit');
        // Two at most for this model.
        expect(c.shownCounts()).toEqual([1, 2]);
    });

    it('says the cost, the pictures left today and the budget before Generate', async () => {
        const { el, c, flush } = await render();
        c.prompt.set('fruit');
        // The model's abilities arrive with the first answer, so its quality is asked again.
        await new Promise((r) => setTimeout(r, 350));
        await flush();
        expect(el.querySelector('.ai-estimate')?.textContent).toContain('Cost: $0.21. Pictures left today: 16. $12.40 of this month\'s $20.00 left.');
        expect(ai.info).toHaveBeenLastCalledWith(expect.objectContaining({ image: expect.objectContaining({ quality: 'medium', count: 1 }) }));
    });

    it('asks for the estimate once per change, though each answer is a new object', async () => {
        ai.info.mockImplementation(async () => structuredClone(infoWith()));
        const { c, flush } = await render();
        await new Promise((r) => setTimeout(r, 700));
        await flush();
        const settled = ai.info.mock.calls.length;
        expect(settled).toBeLessThanOrEqual(2);
        await new Promise((r) => setTimeout(r, 700));
        await flush();
        expect(ai.info.mock.calls.length).toBe(settled);
        c.count.set(3);
        await new Promise((r) => setTimeout(r, 400));
        await flush();
        expect(ai.info.mock.calls.length).toBe(settled + 1);
    });

    it('turns Generate off when the call would cost more than the month has left', async () => {
        ai.info.mockResolvedValue(infoWith({ budget: { monthlyUsd: 20, spent: 19.95, left: 0.05 } }));
        const { el, c, flush } = await render();
        c.prompt.set('fruit');
        await flush();
        expect(el.querySelector('.ai-blocked')?.textContent).toContain('This month\'s AI budget has too little left');
    });

    it('turns Generate off with the reason when the allowance or the budget would run out', async () => {
        ai.info.mockResolvedValue(infoWith({ allowance: { perDay: 20, used: 20, left: 0 } }));
        const { el, c, flush } = await render();
        c.prompt.set('fruit');
        await flush();
        expect(el.querySelector('.ai-blocked')?.textContent).toContain('You have 0 of your 20 pictures left today');
        expect(el.querySelector<HTMLButtonElement>('.ai-generate')?.disabled).toBe(true);
        ai.info.mockResolvedValue(infoWith({ budget: { monthlyUsd: 20, spent: 20, left: 0 } }));
        c.count.set(2);
        await new Promise((r) => setTimeout(r, 350));
        await flush();
        expect(el.querySelector('.ai-blocked')?.textContent).toContain('This month\'s AI budget has too little left');
    });

    it('says when no model is set, and in test mode that the pictures are grey and free', async () => {
        ai.info.mockResolvedValue(infoWith({ models: [], estimate: null }));
        const first = await render();
        expect(first.el.querySelector('.ai-blocked')?.textContent).toContain('No picture model is set');
        TestBed.resetTestingModule();
        ai.info.mockResolvedValue(infoWith({ test: true }));
        const { el, c, flush } = await render();
        c.prompt.set('fruit');
        await flush();
        expect(el.querySelector('.ai-test-note')?.textContent).toContain('Test mode');
        expect(el.querySelector('.ai-estimate')?.textContent).toContain('Test mode: free.');
        expect(el.querySelector('.ai-estimate')?.textContent).not.toContain('this month');
    });

    it('generates, shows the pictures, and saves one to the library with its note', async () => {
        const { el, c, flush, fixture } = await render();
        const saved: MediaAiSaved[] = [];
        fixture.componentInstance.saved.subscribe((s) => saved.push(s));
        c.prompt.set('A bowl of fresh fruit on a wooden table in the morning light');
        await flush();
        el.querySelector<HTMLButtonElement>('.ai-generate')!.click();
        await flush();
        expect(ai.generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'A bowl of fresh fruit on a wooden table in the morning light', model: { connection: 'openai', model: 'gpt-image-2' } }));
        expect(el.querySelectorAll('.ai-tile img')).toHaveLength(1);
        expect(el.querySelector('.ai-generate')?.textContent).toContain('Generate again');
        el.querySelector<HTMLButtonElement>('.ai-save')!.click();
        await flush();
        const file = upload.uploadFile.mock.calls[0][0] as File;
        expect(file.name).toBe('a-bowl-of-fresh-fruit-on-a-wooden-table-in-the-mor.webp');
        const record = store.addBatch.mock.calls[0][0][0];
        expect(record.title).toBe('A bowl of fresh fruit on a wooden...');
        expect(record.ai).toMatchObject({ prompt: 'A bowl of fresh fruit on a wooden table in the morning light', model: 'gpt-image-2', connection: 'openai', costUsd: 0.053, recordId: 'r1', purpose: 'arc-media-image' });
        expect(saved[0].id).toBe('media-1');
        expect(el.querySelector('.ai-saved')).not.toBeNull();
    });

    it('takes a saved picture back out of Storage when its library record fails', async () => {
        store.addBatch.mockReturnValue({ subscribe: (o: { error: (e: Error) => void }) => (o.error(new Error('denied')), { unsubscribe() {} }) });
        const { el, c, flush } = await render();
        c.prompt.set('fruit');
        await flush();
        el.querySelector<HTMLButtonElement>('.ai-generate')!.click();
        await flush();
        el.querySelector<HTMLButtonElement>('.ai-save')!.click();
        await flush();
        expect(upload.removeStored).toHaveBeenCalled();
        expect(el.querySelector('.ai-error')?.textContent).toContain('The picture could not be saved. Try again.');
        // The raw error stays in the console (RF5 5.2).
        expect(el.querySelector('.ai-error')?.textContent).not.toContain('denied');
    });

    it('says why nothing was made, and drops an answer after Stop waiting', async () => {
        ai.generate.mockResolvedValueOnce({ ok: false, reason: 'blocked', detail: 'safety' });
        const { el, c, flush } = await render();
        c.prompt.set('fruit');
        await flush();
        el.querySelector<HTMLButtonElement>('.ai-generate')!.click();
        await flush();
        expect(el.querySelector('.ai-error')?.textContent).toContain('The provider would not make this picture');
        let finish!: (v: unknown) => void;
        ai.generate.mockImplementationOnce(() => new Promise((r) => (finish = r)));
        el.querySelector<HTMLButtonElement>('.ai-generate')!.click();
        await flush();
        expect(el.querySelectorAll('.ai-placeholder')).toHaveLength(1);
        el.querySelector<HTMLButtonElement>('.ai-cancel')!.click();
        await flush();
        finish({ ok: true, files: [{ path: 'p', mimeType: 'image/png', bytes: 1, width: 1, height: 1 }], recordId: 'r', purpose: 'arc-media-image', model: { connection: 'openai', model: 'gpt-image-2' }, settings: {}, costUsd: 0, test: false });
        await flush();
        expect(el.querySelectorAll('.ai-tile img')).toHaveLength(0);
    });

    it('starts from the caller\'s preset, and edits a library picture with Edit with AI', async () => {
        const { c, el, flush } = await render({ preset: { purpose: 'cover', prompt: 'A cover', model: 'other/seeded', seed: 5, count: 2 }, editOf: { id: 'm9', url: 'https://x/m9-s.webp', title: 'Beach' } });
        expect(c.prompt()).toBe('A cover');
        expect(c.model()?.model).toBe('seeded');
        expect(c.image()).toMatchObject({ seed: 5, count: 2 });
        expect(el.querySelector('.ai-edit-source')?.textContent).toContain('Beach');
        expect(el.querySelector('.ai-generate')?.textContent).toContain('Make the change');
        el.querySelector<HTMLButtonElement>('.ai-generate')!.click();
        await flush();
        expect(ai.generate).toHaveBeenCalledWith(expect.objectContaining({ editOf: 'm9', purpose: 'cover' }));
        el.querySelector<HTMLButtonElement>('.ai-save')!.click();
        await flush();
        expect(store.addBatch.mock.calls[0][0][0].ai.editOf).toBe('m9');
    });
});
