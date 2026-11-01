/**
 * Settings, AI (docs/features/ai.html): a checklist says what is left; a provider card says
 * where it processes data, how it stands and only its key's preview; a provider is removed
 * after a confirmation in the page, never the browser's; "Use these models" fills the tiers;
 * purposes come from the app's code; usage and calls load when their tab opens.
 */
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, vi } from 'vitest';
import { AiSettingsPage, recentMonths, usd } from './ai-settings.page';
import { aiFormFrom, AiSettingsService, monthUsageFrom, type AiSetupInfo } from './ai-settings.service';
import { translocoTestingModule } from '../../../../../test/transloco-test-providers';

const SETUP: AiSetupInfo = {
    purposes: [{ id: 'menu-scan', label: 'Menu scan', description: 'Reads a menu photo.', tier: 'thorough', output: 'data', maxChars: 20000, pictures: { max: 5, maxMb: 10 }, pdfs: null, perKeyPerDay: 20, timeoutSeconds: 60 }],
    presets: [
        { id: 'alibaba-eu', label: 'Alibaba Cloud Model Studio, Frankfurt (EU)', kind: 'openai', processesIn: 'Germany (Frankfurt)', needsWorkspace: true, needsAddress: false, reportsCost: false, models: [{ model: 'qwen3-vl-plus', reads: ['pictures'], schema: 'json', priceIn: 0.2, priceOut: 1.6, recommend: ['cheap', 'fast', 'thorough'] }] },
        {
            id: 'openrouter', label: 'OpenRouter', kind: 'openai', processesIn: 'Its host', needsWorkspace: false, needsAddress: false, reportsCost: true,
            models: [
                { model: 'qwen/qwen3.8-flash', reads: ['pictures'], schema: 'strict', recommend: ['fast', 'thorough'] },
                { model: 'qwen/qwen3.7-flash', reads: ['pictures'], schema: 'json', recommend: ['cheap'] },
            ],
        },
        { id: 'vertex', label: 'Google Vertex AI (Gemini)', kind: 'vertex', processesIn: 'The location', needsWorkspace: false, needsAddress: false, reportsCost: false, models: [] },
    ],
    pricesCheckedOn: '2026-10-28',
    defaultVertexLocation: 'eu',
};

async function render(stored: Record<string, unknown> = {}) {
    const service = {
        setup: vi.fn(async () => SETUP),
        load: vi.fn(async () => aiFormFrom(stored)),
        save: vi.fn(async () => undefined),
        savePart: vi.fn(async () => undefined),
        callContent: vi.fn(async () => ({ instruction: 'Read.', parts: [], answer: 'Tea 4.50' })),
        saveConnection: vi.fn(async () => undefined),
        setKey: vi.fn(async () => ({ keyPreview: '••••9876', keySetAt: '2026-10-28T10:00:00Z', keySetBy: 'admin@example.com' })),
        removeKey: vi.fn(async () => undefined),
        test: vi.fn(async () => ({ ok: true, ms: 800, reply: 'OK', costUsd: 0.00001 })),
        usage: vi.fn(async (month: string) => monthUsageFrom(month, { calls: 2, failed: 0, costUsd: 0.01, byPurpose: { 'menu-scan': { calls: 2, costUsd: 0.01 } } }, [])),
        recentCalls: vi.fn(async () => []),
        allCalls: vi.fn(async () => []),
        fileUrl: vi.fn(),
    };
    await TestBed.configureTestingModule({
        imports: [AiSettingsPage, translocoTestingModule()],
        providers: [provideRouter([]), { provide: AiSettingsService, useValue: service }],
    }).compileComponents();
    const fixture = TestBed.createComponent(AiSettingsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const settle = async () => {
        await fixture.whenStable();
        fixture.detectChanges();
    };
    return { page: fixture.nativeElement as HTMLElement, component: fixture.componentInstance, service, settle };
}

const working = { preset: 'openrouter', label: 'OpenRouter', keyPreview: '••••1234', keySetBy: 'a@example.com', keySetAt: '2026-10-01T00:00:00Z', lastOkAt: '2026-10-28T09:00:00Z' };

describe('AiSettingsPage', () => {
    it('says what test mode means, and lists what is left to do', async () => {
        const { page } = await render();
        expect(page.querySelector('.test-note')?.textContent).toContain('nothing is spent');
        expect(page.querySelector<HTMLSelectElement>('#aiMode')?.value).toBe('test');
        const steps = [...page.querySelectorAll('.checklist .check')];
        expect(steps.map((s) => s.classList.contains('done'))).toEqual([false, false, true, false]);
        expect(page.querySelector('.no-providers')?.textContent).toContain('No provider is connected yet.');
    });

    it('ticks the checklist as the provider works, the models are set and Live is saved', async () => {
        const { page } = await render({ mode: 'live', connections: { or: working }, tiers: { thorough: [{ connection: 'or', model: 'qwen/qwen3.8-flash' }] } });
        expect([...page.querySelectorAll('.checklist .check')].every((s) => s.classList.contains('done'))).toBe(true);
        expect(page.querySelector('.live-warning')).toBeNull();
    });

    it('warns when Live is chosen before a provider works', async () => {
        const { page, component, settle } = await render();
        component.patch({ mode: 'live' });
        await settle();
        expect(page.querySelector('.live-warning')?.textContent).toContain('Live calls need a working provider and models');
    });

    it('shows a provider with where it processes data, how it stands and only its key preview', async () => {
        const { page } = await render({ connections: { or: working, nokey: { preset: 'openrouter', label: 'Spare' }, broken: { ...working, label: 'Broken', lastError: 'the provider refused the key (401): Invalid' } } });
        const card = page.querySelector('.connection[data-id="or"]')!;
        expect(card.textContent).toContain('Processes data in: Its host');
        expect(card.textContent).toContain('Key ••••1234, set by a@example.com');
        expect(card.querySelector('.status')?.textContent).toContain('Working');
        expect(card.querySelector('input[type="password"]')).toBeNull();
        expect(card.textContent).not.toContain('(OpenRouter)');
        expect(page.querySelector('.connection[data-id="nokey"] .status')?.textContent).toContain('Key needed');
        const broken = page.querySelector('.connection[data-id="broken"]')!;
        expect(broken.querySelector('.status')?.textContent).toContain('Not working');
        expect(broken.querySelector('.card-error')?.textContent).toContain('did not accept the key');
    });

    it('removes a provider after a confirmation in the page, from every list that named it, and saves', async () => {
        const { page, component, service, settle } = await render({
            connections: { qwen: { preset: 'alibaba-eu' }, router: { preset: 'openrouter', keyPreview: '••••0000' } },
            tiers: { fast: [{ connection: 'router', model: 'x' }, { connection: 'qwen', model: 'qwen3-vl-plus' }] },
            purposes: { 'menu-scan': { models: [{ connection: 'router', model: 'x' }] } },
        });
        const confirm = vi.spyOn(window, 'confirm');
        page.querySelector<HTMLButtonElement>('.connection[data-id="router"] .remove')!.click();
        await settle();
        expect(confirm).not.toHaveBeenCalled();
        page.querySelector<HTMLButtonElement>('.connection[data-id="router"] .confirm-yes')!.click();
        await settle();
        await settle();
        expect(service.removeKey).toHaveBeenCalledWith('router');
        expect(service.savePart).toHaveBeenCalledWith(expect.objectContaining({ tiers: { cheap: [], fast: [{ connection: 'qwen', model: 'qwen3-vl-plus' }], thorough: [] } }));
        expect(service.save).not.toHaveBeenCalled();
        expect(component.form().connections.map((c) => c.id)).toEqual(['qwen']);
        expect(component.form().tiers.fast).toEqual([{ connection: 'qwen', model: 'qwen3-vl-plus' }]);
        expect(component.form().purposes['menu-scan'].models).toEqual([]);
        expect(page.querySelector('.notice')?.textContent).toContain('were removed');
    });

    it('offers the provider\'s recommended models and sets them in one click, saving only the tiers', async () => {
        const { page, component, service, settle } = await render({ connections: { or: working } });
        component.patch({ mode: 'live' });
        await settle();
        expect(page.querySelector('.recommend')?.textContent).toContain('qwen/qwen3.8-flash');
        page.querySelector<HTMLButtonElement>('.use-recommended')!.click();
        await settle();
        await settle();
        expect(component.form().tiers).toEqual({
            cheap: [{ connection: 'or', model: 'qwen/qwen3.7-flash' }],
            fast: [{ connection: 'or', model: 'qwen/qwen3.8-flash' }],
            thorough: [{ connection: 'or', model: 'qwen/qwen3.8-flash' }],
        });
        expect(service.savePart).toHaveBeenCalledWith({ tiers: component.form().tiers });
        expect(service.save).not.toHaveBeenCalled();
        expect(component.loaded()?.mode).toBe('test');
        expect(component.unsaved()).toBe(true);
        expect(page.querySelector('.recommend')).toBeNull();
    });

    it('tests a provider with a model it knows and says what the test cost', async () => {
        const { page, service, settle } = await render({ connections: { or: working } });
        page.querySelector<HTMLButtonElement>('.connection[data-id="or"] .test')!.click();
        await settle();
        await settle();
        expect(service.test).toHaveBeenCalledWith('or', 'qwen/qwen3.8-flash');
        expect(page.querySelector('.connection[data-id="or"]')!.textContent).toContain('This test cost < $0.0001');
    });

    it('warns that the budget cannot count a model with no price, and does not for one whose provider reports cost', async () => {
        const { page, component, settle } = await render({
            connections: { or: working, qwen: { preset: 'alibaba-eu', workspace: 'w', keyPreview: '••••2222', lastOkAt: '2026-10-28T09:00:00Z' }, g: { preset: 'vertex' } },
            tiers: { fast: [{ connection: 'or', model: 'qwen/qwen3.8-flash' }, { connection: 'qwen', model: 'qwen3-vl-plus' }], thorough: [{ connection: 'g', model: 'gemini-3.8-flash' }] },
        });
        expect(component.unpricedNames()).toBe('gemini-3.8-flash');
        const step = page.querySelectorAll('.checklist .check')[2];
        expect(step.classList.contains('done')).toBe(false);
        expect(step.querySelector('.unpriced-warning')?.textContent).toContain('gemini-3.8-flash');
        component.setPrice('g/gemini-3.8-flash', 'priceIn', 0.5);
        component.setPrice('g/gemini-3.8-flash', 'priceOut', 3);
        await settle();
        expect(page.querySelectorAll('.checklist .check')[2].classList.contains('done')).toBe(true);
    });

    it('marks a provider Key needed once a changed workspace is saved', async () => {
        const { page, component, settle } = await render({ connections: { qwen: { preset: 'alibaba-eu', workspace: 'w1', keyPreview: '••••2222', lastOkAt: '2026-10-28T09:00:00Z' } } });
        component.patchConnection('qwen', { workspace: 'w2' });
        await component.save();
        await settle();
        expect(page.querySelector('.connection[data-id="qwen"] .status')?.textContent).toContain('Key needed');
    });

    it('loads a call\'s kept content only when it is opened', async () => {
        const { page, component, service, settle } = await render();
        service.recentCalls.mockResolvedValue([{ id: 'c1', createdAt: null, purpose: 'menu-scan', test: false, outcome: 'ok', connection: null, model: null, tokensIn: 1, tokensOut: 1, tokensThinking: 0, costUsd: 0, costFrom: 'none', ms: 10, ref: null, limitKey: null, units: 1, input: { chars: 1, files: 0, bytes: 0 }, attempts: [], hasContent: true }] as never);
        component.openTab('calls');
        await settle();
        await settle();
        expect(service.callContent).not.toHaveBeenCalled();
        await component.toggleCall('c1');
        await settle();
        expect(service.callContent).toHaveBeenCalledWith('c1');
        expect(page.querySelector('.call-details')?.textContent).toContain('Tea 4.50');
    });

    it('says there are unsaved changes, and keeps the budget when its field is emptied', async () => {
        const { page, component, settle } = await render({ budget: { monthlyUsd: 35 } });
        expect(page.querySelector('.unsaved')).toBeNull();
        component.setBudget('');
        component.setBudget(null);
        expect(component.form().monthlyUsd).toBe(35);
        component.setBudget(0);
        await settle();
        expect(component.form().monthlyUsd).toBe(0);
        expect(page.querySelector('.unsaved')?.textContent).toContain('not saved yet');
    });

    it('lists the app\'s purposes with what they take, an allowance and the keep content switch', async () => {
        const { page, component, settle } = await render();
        component.openTab('purposes');
        await settle();
        const card = page.querySelector('.purpose[data-id="menu-scan"]')!;
        expect(card.textContent).toContain('Menu scan');
        expect(card.textContent).toContain('text up to 20,000 characters');
        expect(card.textContent).toContain('up to 5 pictures of 10 MB');
        expect(card.textContent).toContain('Answers with data in a fixed shape');
        expect(card.querySelector<HTMLSelectElement>('#aiUse-menu-scan')!.selectedOptions[0].textContent).toContain('Thorough tier');
        expect(card.querySelector<HTMLInputElement>('#aiKeep-menu-scan')!.checked).toBe(false);
        expect(card.querySelector<HTMLInputElement>('#aiAllow-menu-scan')!.placeholder).toBe('20');
    });

    it('offers no allowance field for a purpose with none in the code', async () => {
        const { page, component, settle } = await render();
        component.setup.update((s) => s && { ...s, purposes: [{ ...s.purposes[0], perKeyPerDay: null }] });
        component.openTab('purposes');
        await settle();
        expect(page.querySelector('#aiAllow-menu-scan')).toBeNull();
    });

    it('loads the month\'s usage when its tab opens', async () => {
        const { page, component, service, settle } = await render();
        component.openTab('usage');
        await settle();
        await settle();
        expect(service.usage).toHaveBeenCalledWith(recentMonths()[0]);
        expect(page.querySelector('.totals')?.textContent).toContain('$0.01');
        expect(page.querySelector('.usage-table')?.textContent).toContain('Menu scan');
    });

    it('names calls by their purpose\'s label', async () => {
        const { component } = await render();
        expect(component.purposeLabel('menu-scan')).toBe('Menu scan');
        expect(component.purposeLabel('arc-connection-test')).toBe('Provider test');
        expect(component.purposeLabel('gone')).toBe('gone');
    });
});

describe('usd', () => {
    it('shows fractions of a cent for small sums', () => {
        expect(usd(0)).toBe('$0');
        expect(usd(0.00052)).toBe('$0.0005');
        expect(usd(0.000021)).toBe('< $0.0001');
        expect(usd(12.345)).toBe('$12.35');
    });
});
