/**
 * Connecting a provider (docs/features/ai.html): choose it, follow its steps, paste the key,
 * then one click saves the provider alone, sends the key to the server and tests it. A key
 * the provider refuses keeps the panel open with what to do, and trying again adds no second
 * provider.
 */
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { AiConnectComponent, type AiConnected } from './ai-connect.component';
import { AiSettingsService, type AiConnectionForm, type AiPresetInfo } from './ai-settings.service';
import { failureAdvice } from './ai-provider-guide';
import { translocoTestingModule } from '../../../../../test/transloco-test-providers';

const PRESETS: AiPresetInfo[] = [
    { id: 'alibaba-eu', label: 'Alibaba Cloud Model Studio, Frankfurt (EU)', kind: 'openai', processesIn: 'Germany (Frankfurt)', needsWorkspace: true, needsAddress: false, reportsCost: false, models: [{ model: 'qwen3-vl-plus', reads: ['pictures'], schema: 'json', recommend: ['fast'] }] },
    { id: 'openrouter', label: 'OpenRouter', kind: 'openai', processesIn: 'Its host', needsWorkspace: false, needsAddress: false, reportsCost: true, models: [{ model: 'qwen/qwen3.8-flash', reads: ['pictures'], schema: 'strict', recommend: ['fast', 'thorough'] }] },
    { id: 'vertex', label: 'Google Vertex AI (Gemini)', kind: 'vertex', processesIn: 'The location', needsWorkspace: false, needsAddress: false, reportsCost: false, models: [] },
    { id: 'anthropic', label: 'Anthropic (Claude)', kind: 'anthropic', processesIn: 'Worldwide', needsWorkspace: false, needsAddress: false, reportsCost: false, needsKey: true, testedLive: false, docsReadOn: '2026-11-02', models: [{ model: 'claude-sonnet-5-5', reads: ['pictures'], schema: 'strict', recommend: ['fast'] }] },
    { id: 'elevenlabs', label: 'ElevenLabs', kind: 'elevenlabs', processesIn: 'The US', needsWorkspace: false, needsAddress: false, reportsCost: false, needsKey: true, makesText: false, makesSpeech: true, files: 'elevenlabs', testedLive: false, docsReadOn: '2026-11-02', models: [{ model: 'eleven_v4', makes: 'speech', reads: [], schema: 'json', recommend: ['default'] }] },
    { id: 'other', label: 'Other OpenAI-style address', kind: 'openai', processesIn: 'Where the admin says', needsWorkspace: false, needsAddress: true, reportsCost: false, models: [] },
];

async function render(options: { existing?: AiConnectionForm; test?: () => Promise<unknown>; voices?: () => Promise<unknown> } = {}) {
    const service = {
        saveConnection: vi.fn(async () => undefined),
        setKey: vi.fn(async () => ({ keyPreview: '••••abcd', keySetAt: '2026-10-28T10:00:00Z', keySetBy: 'admin@example.com' })),
        test: vi.fn(options.test ?? (async () => ({ ok: true, ms: 900, reply: 'OK', costUsd: 0.00002 }))),
        voices: vi.fn(options.voices ?? (async () => ({ ok: true, voices: [] }))),
    };
    await TestBed.configureTestingModule({
        imports: [AiConnectComponent, translocoTestingModule()],
        providers: [{ provide: AiSettingsService, useValue: service }],
    }).compileComponents();
    const fixture = TestBed.createComponent(AiConnectComponent);
    fixture.componentRef.setInput('presets', PRESETS);
    fixture.componentRef.setInput('takenIds', ['openrouter']);
    if (options.existing) fixture.componentRef.setInput('existing', options.existing);
    const connected: AiConnected[] = [];
    const saved: AiConnectionForm[] = [];
    fixture.componentInstance.connected.subscribe((e) => connected.push(e));
    fixture.componentInstance.saved.subscribe((c) => saved.push(c));
    fixture.detectChanges();
    const settle = async () => {
        await fixture.whenStable();
        fixture.detectChanges();
    };
    return { page: fixture.nativeElement as HTMLElement, component: fixture.componentInstance, service, connected, saved, settle };
}

describe('AiConnectComponent', () => {
    it('lists the providers with the easiest first, then shows only the chosen one and its steps', async () => {
        const { page, component, settle } = await render();
        expect(page.querySelector('.preset strong')?.textContent).toBe('OpenRouter');
        expect(page.querySelector('.preset')?.textContent).toContain('Easiest to start');
        component.choose('openrouter');
        await settle();
        expect(page.querySelectorAll('.preset').length).toBe(1);
        expect(page.querySelector('.choose-another')).not.toBeNull();
        const steps = [...page.querySelectorAll('ol.guide li')].map((li) => li.textContent ?? '');
        expect(steps.length).toBe(4);
        expect(steps[2]).toContain('starts with sk-or-');
        expect(page.querySelector<HTMLAnchorElement>('ol.guide a')?.href).toBe('https://openrouter.ai/settings/keys');
        expect(component.model()).toBe('qwen/qwen3.8-flash');
    });

    it('says what is missing, and warns about a key that does not look like the provider\'s', async () => {
        const { page, component, settle } = await render();
        component.choose('openrouter');
        component.model.set('qwen/qwen3.8-flash');
        await settle();
        expect(page.querySelector<HTMLButtonElement>('.connect-button')!.disabled).toBe(true);
        expect(page.textContent).toContain('Paste the key.');
        component.key.set('abc123xyz');
        await settle();
        expect(page.querySelector('.prefix-warning')?.textContent).toContain('OpenRouter keys start with sk-or-');
        component.key.set('sk-or-v1-abcdefgh');
        await settle();
        expect(page.querySelector('.prefix-warning')).toBeNull();
        expect(page.querySelector<HTMLButtonElement>('.connect-button')!.disabled).toBe(false);
    });

    it('saves the provider alone, sets the key, tests it, and hands back a working provider', async () => {
        const { component, service, connected, saved } = await render();
        component.choose('openrouter');
        component.key.set(' sk-or-v1-abcdefgh ');
        await component.connect();
        expect(service.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ id: 'openrouter-2', preset: 'openrouter', label: 'OpenRouter' }));
        expect(service.setKey).toHaveBeenCalledWith('openrouter-2', 'sk-or-v1-abcdefgh');
        expect(service.test).toHaveBeenCalledWith('openrouter-2', 'qwen/qwen3.8-flash');
        expect(saved.at(-1)).toMatchObject({ keyPreview: '••••abcd' });
        expect(connected).toEqual([expect.objectContaining({ model: 'qwen/qwen3.8-flash', replaced: false, connection: expect.objectContaining({ id: 'openrouter-2', keyPreview: '••••abcd', lastError: null }) })]);
        expect(component.key()).toBe('');
    });

    it('keeps the panel open with what to do when the key is refused, and adds no second provider on a retry', async () => {
        let first = true;
        const { page, component, service, connected, settle } = await render({
            test: async () => {
                const r = first ? { ok: false, ms: 300, failure: 'key-refused', detail: 'the provider refused the key (401): No auth credentials found' } : { ok: true, ms: 500, reply: 'OK' };
                first = false;
                return r;
            },
        });
        component.choose('openrouter');
        component.key.set('sk-or-v1-wrongwrong');
        await component.connect();
        await settle();
        expect(connected).toEqual([]);
        expect(page.querySelector('.result')?.textContent).toContain('OpenRouter did not accept the key');
        expect(page.querySelector('.result details')?.textContent).toContain('No auth credentials found');
        component.key.set('sk-or-v1-rightright');
        await component.connect();
        expect(service.saveConnection).toHaveBeenCalledTimes(1);
        expect(service.setKey).toHaveBeenLastCalledWith('openrouter-2', 'sk-or-v1-rightright');
        expect(connected.length).toBe(1);
    });

    it('replaces the key of an existing provider without saving it again', async () => {
        const existing: AiConnectionForm = { id: 'or', preset: 'openrouter', label: 'OpenRouter', workspace: '', baseUrl: '', location: '', processesIn: '', keyPreview: '••••1111', keySetAt: null, keySetBy: null, lastOkAt: null, lastError: 'refused' };
        const { page, component, service, connected } = await render({ existing });
        expect(page.querySelector('.preset')).toBeNull();
        expect(page.textContent).toContain('New key for OpenRouter');
        component.key.set('sk-or-v1-newnewnew');
        await component.connect();
        expect(service.saveConnection).not.toHaveBeenCalled();
        expect(service.setKey).toHaveBeenCalledWith('or', 'sk-or-v1-newnewnew');
        expect(connected[0]).toMatchObject({ replaced: true, connection: { id: 'or', lastError: null } });
    });

    it('connects Vertex with no key', async () => {
        const { page, component, service, settle } = await render();
        component.choose('vertex');
        component.model.set('gemini-3.8-flash');
        await settle();
        expect(page.querySelector('#aiConnectKey')).toBeNull();
        expect(page.textContent).toContain('Set up Google Cloud');
        await component.connect();
        expect(service.setKey).not.toHaveBeenCalled();
        expect(service.test).toHaveBeenCalledWith('google-vertex-ai-gemini', 'gemini-3.8-flash');
    });
});

describe('AiConnectComponent, a provider Arc makes only speech with (AM2)', () => {
    it('asks for no test model, and checks the key by reading its voices', async () => {
        const { page, component, service, connected, settle } = await render();
        component.choose('elevenlabs');
        component.key.set('sk_0123456789abcdef');
        await settle();
        expect(page.querySelector('#aiConnectModel')).toBeNull();
        expect(page.querySelector('.voices-check-hint')?.textContent).toContain('reading this provider\'s voices');
        expect(component.ready()).toBe(true);
        await component.connect();
        expect(service.test).not.toHaveBeenCalled();
        expect(service.voices).toHaveBeenCalledWith('elevenlabs', true);
        expect(connected[0]).toMatchObject({ model: '', connection: { id: 'elevenlabs', lastError: null } });
    });

    it('keeps the panel open with what to do when the voices cannot be read with the key', async () => {
        const { component, connected, saved } = await render({ voices: async () => ({ ok: false, detail: 'ElevenLabs refused the key (401): Invalid API key' }) });
        component.choose('elevenlabs');
        component.key.set('sk_0123456789abcdef');
        await component.connect();
        expect(connected).toEqual([]);
        expect(component.phase()).toBe('failed');
        expect(component.advice()).toBe('advice_key');
        expect(saved.at(-1)?.lastError).toContain('refused the key');
    });
});

describe('AiConnectComponent, AM1 providers', () => {
    it('marks a provider not tested live, and asks for its key and its guide whatever its connector', async () => {
        const { page, component, service, settle } = await render();
        const anthropic = [...page.querySelectorAll('.preset')].find((e) => e.textContent?.includes('Anthropic'))!;
        expect(anthropic.querySelector('.untested-live')?.textContent).toContain('Not tested live yet');
        component.choose('anthropic');
        await settle();
        expect(page.querySelector('#aiConnectKey')).not.toBeNull();
        expect(page.querySelector('ol.guide li')?.textContent).toContain('Sign in to Anthropic (Claude)');
        expect(page.textContent).toContain('Paste the key.');
        component.key.set('sk-ant-api03-abcdefgh');
        await component.connect();
        expect(service.setKey).toHaveBeenCalledWith('anthropic-claude', 'sk-ant-api03-abcdefgh');
    });

    it('saves Other with the key header chosen before the key is set, and refuses a header the server would not take', async () => {
        const { page, component, service, settle } = await render();
        component.choose('other');
        component.baseUrl.set('https://api.example.com/v1');
        component.model.set('m1');
        component.key.set('secret-key-123');
        await settle();
        expect([...page.querySelectorAll<HTMLOptionElement>('#aiConnectHeader option')].map((o) => o.value)).toEqual(['', 'api-key', 'x-api-key', 'custom']);
        component.headerChoice.set('custom');
        component.customHeader.set('Cookie');
        await settle();
        expect(page.querySelector('#aiConnectHeaderName')).not.toBeNull();
        expect(component.missing()).toBe('admin.settings.ai.header_invalid');
        expect(page.querySelector<HTMLButtonElement>('.connect-button')!.disabled).toBe(true);
        component.customHeader.set('X-My-Key');
        await settle();
        expect(component.ready()).toBe(true);
        await component.connect();
        expect(service.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ preset: 'other', header: 'x-my-key', baseUrl: 'https://api.example.com/v1' }));
        expect(service.saveConnection.mock.invocationCallOrder[0]).toBeLessThan(service.setKey.mock.invocationCallOrder[0]);
    });
});

describe('failureAdvice', () => {
    it('turns a provider\'s answer into what to do', () => {
        expect(failureAdvice('key-refused')).toBe('advice_key');
        expect(failureAdvice('unavailable', 'the provider account has no credit (402): Insufficient credits')).toBe('advice_credit');
        expect(failureAdvice('retired', 'the model is not there (404)')).toBe('advice_model');
        expect(failureAdvice('off', 'Vertex AI refused the project\'s service account (403)')).toBe('advice_vertex');
        expect(failureAdvice('unavailable', '429: Rate limit')).toBe('advice_busy');
        expect(failureAdvice('timeout')).toBe('advice_slow');
        expect(failureAdvice(undefined, 'the key of connection or was set for another address')).toBe('advice_key_again');
        expect(failureAdvice(undefined, 'the key of connection or was set for another header: set it again in Settings, AI')).toBe('advice_key_again');
        expect(failureAdvice(undefined, 'the provider refused the key (401): x')).toBe('advice_key');
        expect(failureAdvice(undefined, 'something odd')).toBe('advice_other');
    });
});
