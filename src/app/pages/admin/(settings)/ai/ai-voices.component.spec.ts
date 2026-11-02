/**
 * A speech connection's voices (docs/features/ai.html; specs/ai-media-spec.md, AM-D18): the
 * list with search, Play from the provider's own sample or, without one, a sample the server
 * makes once, and Use in choose mode.
 */
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiVoicesComponent } from './ai-voices.component';
import { AiSettingsService, type AiVoice } from './ai-settings.service';
import { translocoTestingModule } from '../../../../../test/transloco-test-providers';

const VOICES: AiVoice[] = [
    { id: 'el-aria', name: 'Aria', languages: ['en-US', 'hi-IN'], gender: 'female', labels: ['narration'], previewUrl: 'https://cdn.example.com/aria.mp3', models: [] },
    { id: 'priya', name: 'Priya', languages: ['hi-IN'], gender: 'female', labels: [], previewUrl: null, models: ['bulbul:v3'] },
    { id: 'kabir', name: 'Kabir', languages: ['hi-IN'], gender: 'male', labels: [], previewUrl: null, models: ['bulbul:v9'] },
];

const played: string[] = [];
class FakeAudio {
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public src: string) {}
    play(): Promise<void> {
        played.push(this.src);
        return Promise.resolve();
    }
    pause(): void {}
}

async function render(options: { mode?: 'browse' | 'choose'; chosen?: string; sample?: unknown; list?: unknown } = {}) {
    const service = {
        voices: vi.fn(async () => options.list ?? { ok: true, voices: VOICES }),
        voiceSample: vi.fn(async () => options.sample ?? { ok: true, path: 'ai-files/arc-voice-sample/2026-11/r1.wav', mimeType: 'audio/wav', cached: false, test: true, costUsd: 0 }),
        aiFileUrl: vi.fn(async (path: string) => ({ url: `blob:test/${path}`, contentType: 'audio/wav' })),
    };
    vi.stubGlobal('Audio', FakeAudio);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    await TestBed.configureTestingModule({
        imports: [AiVoicesComponent, translocoTestingModule()],
        providers: [{ provide: AiSettingsService, useValue: service }],
    }).compileComponents();
    const fixture = TestBed.createComponent(AiVoicesComponent);
    fixture.componentRef.setInput('connection', 'sarvam');
    fixture.componentRef.setInput('models', ['bulbul:v3']);
    if (options.mode) fixture.componentRef.setInput('mode', options.mode);
    if (options.chosen) fixture.componentRef.setInput('chosen', options.chosen);
    const picked: string[] = [];
    fixture.componentInstance.picked.subscribe((id) => picked.push(id));
    fixture.detectChanges();
    const settle = async () => {
        await fixture.whenStable();
        await new Promise((r) => setTimeout(r));
        fixture.detectChanges();
    };
    await settle();
    return { el: fixture.nativeElement as HTMLElement, component: fixture.componentInstance, service, settle, picked };
}

const rows = (el: HTMLElement) => [...el.querySelectorAll('.voice')].map((v) => v.querySelector('strong')?.textContent);

afterEach(() => {
    played.length = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('AiVoicesComponent', () => {
    it('lists the voices with gender, languages and labels, and finds them by any of those', async () => {
        const { el, component, settle } = await render();
        expect(rows(el)).toEqual(['Aria', 'Priya', 'Kabir']);
        expect(el.querySelector('.voice')?.textContent).toContain('Female · en-US, hi-IN · narration');
        expect(el.querySelector('.voices-count')?.textContent).toContain('3 of 3 voices');
        component.search.set('male');
        await settle();
        // "male" is in "female" too: both genders match, as a plain search would.
        expect(rows(el)).toHaveLength(3);
        component.search.set('narration');
        await settle();
        expect(rows(el)).toEqual(['Aria']);
    });

    it('plays the provider\'s own sample, with no call to the server', async () => {
        const { el, service, settle } = await render();
        el.querySelector<HTMLButtonElement>('.voice .play')!.click();
        await settle();
        expect(played).toEqual(['https://cdn.example.com/aria.mp3']);
        expect(service.voiceSample).not.toHaveBeenCalled();
    });

    it('has the server make a sample with a model the voice works with, and says a test sample is silent', async () => {
        const { el, service, settle } = await render();
        el.querySelectorAll<HTMLButtonElement>('.voice .play')[1].click();
        await settle();
        expect(service.voiceSample).toHaveBeenCalledWith('sarvam', 'bulbul:v3', 'priya', 'hi-IN');
        expect(played).toEqual(['blob:test/ai-files/arc-voice-sample/2026-11/r1.wav']);
        expect(el.querySelector('.voice-note')?.textContent).toContain('Test mode: the sample is silence');
        // A voice none of the connection's models speaks with is not sent.
        el.querySelectorAll<HTMLButtonElement>('.voice .play')[2].click();
        await settle();
        expect(service.voiceSample).toHaveBeenCalledTimes(1);
        expect(el.querySelector('.voice-note')?.textContent).toContain('None of this connection\'s speech models speaks with this voice');
    });

    it('says a sample in the admin\'s language, else English, never just the first a voice speaks', async () => {
        const { component } = await render();
        expect(component.sampleLanguage({ ...VOICES[1], languages: ['bn-IN', 'en-IN', 'hi-IN'] })).toBe('en-IN');
        expect(component.sampleLanguage({ ...VOICES[1], languages: ['bn-IN', 'ta-IN'] })).toBe('bn-IN');
    });

    it('drops a sample that comes back after another voice was played', async () => {
        let finish!: (v: unknown) => void;
        const { el, service, settle } = await render();
        service.voiceSample.mockImplementationOnce(() => new Promise((r) => (finish = r)));
        el.querySelectorAll<HTMLButtonElement>('.voice .play')[1].click();
        await settle();
        // Aria, with its own sample, while Priya's is still being made.
        el.querySelectorAll<HTMLButtonElement>('.voice .play')[0].click();
        await settle();
        finish({ ok: true, path: 'ai-files/x.wav', mimeType: 'audio/wav', cached: true, test: false, costUsd: 0 });
        await settle();
        expect(played).toEqual(['https://cdn.example.com/aria.mp3']);
        expect(service.aiFileUrl).not.toHaveBeenCalled();
        expect(el.querySelectorAll('.voice .play')[0].getAttribute('aria-label')).toBe('Stop Aria');
    });

    it('says why a sample could not be made, and why the list could not be read', async () => {
        const { el, settle } = await render({ sample: { ok: false, reason: 'limit', detail: 'the month\'s budget is spent' } });
        el.querySelectorAll<HTMLButtonElement>('.voice .play')[1].click();
        await settle();
        expect(el.querySelector('.voice-note')?.textContent).toContain('No sample could be made: the month\'s budget is spent');
        TestBed.resetTestingModule();
        const failed = await render({ list: { ok: false, detail: 'ElevenLabs refused the key (401)' } });
        expect(failed.el.querySelector('.voices-error')?.textContent).toContain('ElevenLabs refused the key (401)');
    });

    it('in choose mode, puts the chosen voice first and hands back the one used', async () => {
        const { el, picked } = await render({ mode: 'choose', chosen: 'priya' });
        expect(rows(el)[0]).toBe('Priya');
        expect(el.querySelector<HTMLButtonElement>('.voice .use')?.disabled).toBe(true);
        el.querySelectorAll<HTMLButtonElement>('.voice .use')[1].click();
        expect(picked).toEqual(['el-aria']);
    });
});
