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
    purposes: [{ id: 'menu-scan', label: 'Menu scan', description: 'Reads a menu photo.', tier: 'thorough', output: 'data', maxChars: 20000, pictures: { max: 5, maxMb: 10 }, pdfs: null, perKeyPerDay: 20, limitKeyLabel: null, timeoutSeconds: 60 }],
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

async function render(stored: Record<string, unknown> = {}, setup: AiSetupInfo = SETUP) {
    const service = {
        setup: vi.fn(async () => setup),
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
        refreshBalance: vi.fn(async () => ({ ok: true, balance: 7.25, unit: 'USD' }) as { ok: true; balance: number | null; unit: string } | { ok: false; detail: string }),
        aiFileUrl: vi.fn(async (path: string) => ({ url: `blob:test/${path}`, contentType: path.endsWith('.png') ? 'image/png' : 'audio/mpeg' })),
        voices: vi.fn(async () => ({ ok: true, voices: [{ id: 'EL_ZED', name: 'Zed', languages: ['en-US'], gender: 'male', labels: [], previewUrl: 'https://cdn.example.com/zed.mp3', models: [] }] })),
        voiceSample: vi.fn(),
        avatars: vi.fn(async () => ({ ok: true, avatars: [{ id: 'look-zed', name: 'Zed', gender: 'male', previewUrl: 'https://files.heygen.ai/zed.jpg', voiceId: 'v1' }] })),
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

    it('tells the admin there is nothing to set up while the app has no purposes and no provider', async () => {
        const { page } = await render({}, { ...SETUP, purposes: [] });
        expect(page.querySelector('.nothing-uses-ai')?.textContent).toContain('Nothing on this site uses AI yet');
        expect(page.querySelector('.checklist')).toBeNull();
        expect(page.querySelector('.no-providers')).not.toBeNull();
    });

    it('keeps the checklist once a provider is added, even with no purposes', async () => {
        const { page } = await render({ connections: { or: working } }, { ...SETUP, purposes: [] });
        expect(page.querySelector('.nothing-uses-ai')).toBeNull();
        expect(page.querySelector('.checklist')).not.toBeNull();
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

    it('offers the provider\'s recommended models and sets them in one click, saving only the tiers and file lists', async () => {
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
        expect(service.savePart).toHaveBeenCalledWith({ tiers: component.form().tiers, lists: component.form().lists });
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
        service.recentCalls.mockResolvedValue([{ id: 'c1', createdAt: null, purpose: 'menu-scan', test: false, outcome: 'ok', connection: null, model: null, tokensIn: 1, tokensOut: 1, tokensThinking: 0, costUsd: 0, costFrom: 'none', ms: 10, ref: null, limitKey: null, units: 1, input: { chars: 1, files: 0, bytes: 0 }, attempts: [], hasContent: true, kind: 'data', tokensCached: 0, tokensCacheWrite: 0, amount: 0, unit: 'tokens', files: [], cached: false, cachedFrom: null }] as never);
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
        expect(card.querySelector('label[for="aiAllow-menu-scan"]')!.textContent).toContain('Daily allowance for each user or business');
    });

    it('names the allowance by what the app calls its keys, here and on the usage and call rows', async () => {
        const { page, component, settle } = await render();
        component.setup.update((s) => s && { ...s, purposes: [{ ...s.purposes[0], limitKeyLabel: 'merchant' }] });
        component.openTab('purposes');
        await settle();
        expect(page.querySelector('label[for="aiAllow-menu-scan"]')!.textContent).toContain('Daily allowance for each merchant');
        expect(page.querySelector('.purpose[data-id="menu-scan"]')!.textContent).toContain('A number your app gives one merchant, such as from their plan, comes first.');
        expect(component.keyName('menu-scan', 'b1')).toBe('merchant b1');
        expect(component.keyName('other', 'b1')).toBe('b1');
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

/** Settings, AI with the presets and purposes of AM1: not tested live, Other's header, INR prices, balances, models that make pictures. */
const MEDIA: AiSetupInfo = {
    ...SETUP,
    purposes: [
        SETUP.purposes[0],
        { id: 'cover', label: 'Cover picture', description: '', tier: 'fast', output: 'text', maxChars: 2000, pictures: null, pdfs: null, perKeyPerDay: 10, limitKeyLabel: null, timeoutSeconds: 60, makes: 'image', allowanceIn: 'pictures', saveTo: null, deleteAfterDays: 90, cacheDays: 365, fallback: true },
        { id: 'voice', label: 'Read aloud', description: '', tier: 'fast', output: 'text', maxChars: 2000, pictures: null, pdfs: null, perKeyPerDay: null, limitKeyLabel: null, timeoutSeconds: 60, makes: 'speech', allowanceIn: 'characters', saveTo: 'app/voice', deleteAfterDays: null, cacheDays: 0, fallback: true },
    ],
    presets: [
        ...SETUP.presets.map((p) => (p.id === 'openrouter' ? { ...p, readsBalance: true } : p)),
        { id: 'other', label: 'Other OpenAI-style address', kind: 'openai', processesIn: 'Where the admin says', needsWorkspace: false, needsAddress: true, reportsCost: false, models: [] },
        { id: 'sarvam', label: 'Sarvam AI', kind: 'openai', processesIn: 'India', needsWorkspace: false, needsAddress: false, reportsCost: false, currency: 'INR', testedLive: false, docsReadOn: '2026-11-02', pricesCheckedOn: '2026-11-02', perMinute: 60, billingUrl: 'https://dashboard.example.com/', models: [{ model: 'sarvam-105b', reads: [], schema: 'json', priceIn: 15, priceOut: 60, recommend: ['fast'] }] },
        {
            id: 'pix', label: 'Pictures Inc', kind: 'openai', processesIn: 'USA', needsWorkspace: false, needsAddress: false, reportsCost: false, models: [
                { model: 'chat-1', reads: [], schema: 'json', priceIn: 1, priceOut: 2 },
                { model: 'pic-1', makes: 'image', unit: 'pictures', reads: [], schema: 'json', price: 0.04 },
            ],
        },
    ],
};

describe('AiSettingsPage, files and AM1 settings', () => {
    it('marks a provider and its models Not tested live yet, with when its docs were read', async () => {
        const { page } = await render({ connections: { s: { preset: 'sarvam', keyPreview: '••••1111' } }, tiers: { fast: [{ connection: 's', model: 'sarvam-105b' }] } }, MEDIA);
        const card = page.querySelector('.connection[data-id="s"]')!;
        expect(card.querySelector('.untested-live')?.textContent).toContain('Not tested live yet');
        expect(card.querySelector('.untested-live-hint')?.textContent).toContain('Built from the provider\'s docs on 2026-11-02');
        expect(page.querySelector('.tier[data-tier="fast"] .model-row .untested-live')).not.toBeNull();
        expect(page.querySelector('.connection[data-id="s"] .billing-line a')?.getAttribute('href')).toBe('https://dashboard.example.com/');
    });

    it('warns that INR prices count 0 until the USD rate is set, and counts the model as unpriced', async () => {
        const { page, component, settle } = await render({ connections: { s: { preset: 'sarvam', keyPreview: '••••1111' } }, tiers: { fast: [{ connection: 's', model: 'sarvam-105b' }] } }, MEDIA);
        expect(page.querySelector('.connection[data-id="s"] .rate-warning')?.textContent).toContain('set the USD value of 1 INR');
        expect(component.unpricedNames()).toBe('sarvam-105b');
        component.toggleDetails('s');
        await settle();
        expect(page.querySelector('label[for="aiRate-s"]')?.textContent).toContain('USD for 1 INR');
        expect(page.querySelector<HTMLInputElement>('#aiPerMin-s')!.placeholder).toBe('60');
        expect(page.querySelector<HTMLInputElement>('#aiAtOnce-s')!.placeholder).toBe('No limit');
        component.setAmount('s', 'usdRate', 0.012);
        component.setLimit('s', 'atOnce', '4');
        component.setLimit('s', 'perMinute', 2.5);
        await settle();
        expect(page.querySelector('.rate-warning')).toBeNull();
        expect(component.unpricedNames()).toBe('');
        expect(component.form().connections[0]).toMatchObject({ usdRate: 0.012, atOnce: 4, perMinute: null });
    });

    it('shows a balance the key can read, refreshes it, and links others to billing', async () => {
        const { page, service, settle } = await render({ connections: { or: { ...working, balance: 3, balanceUnit: 'USD key limit', balanceAt: '2026-11-01T10:00:00Z', lowBalance: 5 } } }, MEDIA);
        const line = page.querySelector('.connection[data-id="or"] .balance-line')!;
        expect(line.textContent).toContain('Balance: 3 USD key limit');
        expect(line.classList.contains('text-danger')).toBe(true);
        line.querySelector<HTMLButtonElement>('.refresh-balance')!.click();
        await settle();
        await settle();
        expect(service.refreshBalance).toHaveBeenCalledWith('or');
        expect(page.querySelector('.connection[data-id="or"] .balance-line')?.textContent).toContain('Balance: 7.25 USD');
        service.refreshBalance.mockResolvedValueOnce({ ok: false, detail: 'the provider refused the key (401)' });
        page.querySelector<HTMLButtonElement>('.connection[data-id="or"] .refresh-balance')!.click();
        await settle();
        await settle();
        expect(page.querySelector('.connection[data-id="or"]')?.textContent).toContain('The balance could not be read: the provider refused the key (401)');
    });

    it('lets Other choose its key header, refuses a bad custom one, and asks for the key again once a new header is saved', async () => {
        const { page, component, service, settle } = await render({ connections: { o: { preset: 'other', baseUrl: 'https://api.example.com/v1', keyPreview: '••••2222', lastOkAt: '2026-10-28T09:00:00Z' } } }, MEDIA);
        component.toggleDetails('o');
        await settle();
        const select = page.querySelector<HTMLSelectElement>('#aiHeader-o')!;
        expect([...select.options].map((o) => o.value)).toEqual(['', 'api-key', 'x-api-key', 'custom']);
        component.setHeaderChoice(component.form().connections[0], 'custom');
        await settle();
        expect(page.querySelector('.header-invalid')).not.toBeNull();
        expect(page.querySelector<HTMLButtonElement>('.save')!.disabled).toBe(true);
        component.patchConnection('o', { header: 'Host' });
        await settle();
        expect(component.formProblem()).toBe('admin.settings.ai.header_invalid');
        component.patchConnection('o', { header: 'x-my-key' });
        await settle();
        expect(component.formProblem()).toBe('');
        expect(await component.save()).toBe(true);
        await settle();
        expect(service.save).toHaveBeenCalled();
        expect(page.querySelector('.connection[data-id="o"] .status')?.textContent).toContain('Key needed');
    });

    it('shows a file list only when a model or purpose makes that kind, and saves it with the page', async () => {
        const { page, component, service, settle } = await render({ connections: { p: { preset: 'pix', keyPreview: '••••3333' } } }, { ...MEDIA, purposes: [] });
        expect([...page.querySelectorAll('.kind-list')].map((e) => e.getAttribute('data-kind'))).toEqual(['image']);
        expect(page.querySelector('.kind-list')?.textContent).toContain('Picture models');
        page.querySelector<HTMLButtonElement>('.kind-list[data-kind="image"] .add-model')!.click();
        await settle();
        expect(component.form().lists.image).toEqual([{ connection: 'p', model: 'pic-1' }]);
        expect(page.querySelector('.kind-list .model')?.getAttribute('list')).toBe('aiModels-p-image');
        await component.save();
        expect(service.save.mock.calls[0][0].lists.image).toEqual([{ connection: 'p', model: 'pic-1' }]);
        const { page: plain } = await (TestBed.resetTestingModule(), render({ connections: { or: working } }, { ...MEDIA, purposes: [] }));
        expect(plain.querySelector('.kind-list')).toBeNull();
    });

    it('offers each list and purpose only the models that make its kind', async () => {
        const { page, component } = await render({ connections: { p: { preset: 'pix' } } }, MEDIA);
        expect(component.modelChoices('p', 'text')).toEqual(['chat-1']);
        expect(component.modelChoices('p', 'image')).toEqual(['pic-1']);
        expect(component.modelChoices('p', 'speech')).toEqual([]);
        expect([...page.querySelectorAll('#aiModels-p-image option')].map((o) => o.getAttribute('value'))).toEqual(['pic-1']);
        expect([...page.querySelectorAll('#aiModels-p-text option')].map((o) => o.getAttribute('value'))).toEqual(['chat-1']);
        component.patchModel('p/my-voice', { makes: 'speech', unit: 'characters' });
        expect(component.modelChoices('p', 'speech')).toEqual(['my-voice']);
    });

    it('starts a picture purpose\'s own list from the picture list, and names the kind\'s list in its choice', async () => {
        const { page, component, settle } = await render({ connections: { p: { preset: 'pix' } }, lists: { image: [{ connection: 'p', model: 'pic-1' }] } }, MEDIA);
        component.openTab('purposes');
        await settle();
        const card = page.querySelector('.purpose[data-id="cover"]')!;
        expect(card.querySelector<HTMLSelectElement>('#aiUse-cover')!.selectedOptions[0].textContent).toContain('Picture models');
        component.useOwnModels(MEDIA.purposes[1], true);
        await settle();
        expect(component.purpose('cover').models).toEqual([{ connection: 'p', model: 'pic-1' }]);
        expect(page.querySelector('.purpose[data-id="cover"] .model')?.getAttribute('list')).toBe('aiModels-p-image');
    });

    it('says 1 day, not 1 days, and 1 picture, in the purpose\'s hints and the amounts', async () => {
        const oneDay: AiSetupInfo = { ...MEDIA, purposes: MEDIA.purposes.map((p) => (p.id === 'cover' ? { ...p, deleteAfterDays: 1, cacheDays: 1 } : p)) };
        const { page, component, settle } = await render({}, oneDay);
        component.openTab('purposes');
        await settle();
        const cover = page.querySelector('.purpose[data-id="cover"]')!;
        expect(cover.textContent).toContain('Leave empty to keep your app\'s 1 day.');
        expect(cover.textContent).toContain('again for 1 day,');
        expect(cover.textContent).not.toContain('1 days');
        expect(component.amountText(1, 'pictures')).toBe('1 picture');
        expect(component.amountText(1, 'seconds')).toBe('1 second');
        expect(component.amountText(2, 'pictures')).toBe('2 pictures');
    });

    it('shows a file purpose\'s kind, where its files go, its allowance unit, the days and the cache switch', async () => {
        const { page, component, settle } = await render({}, MEDIA);
        component.openTab('purposes');
        await settle();
        const cover = page.querySelector('.purpose[data-id="cover"]')!;
        expect(cover.querySelector('.kind-badge')?.textContent).toContain('Pictures');
        expect(cover.querySelector('.files-go')?.textContent).toContain('Arc\'s private AI folder');
        expect(cover.querySelector('label[for="aiAllow-cover"]')?.textContent).toContain('(pictures)');
        expect(cover.querySelector<HTMLInputElement>('#aiDelete-cover')!.placeholder).toBe('90');
        expect(cover.textContent).toContain('keep your app\'s 90 days');
        expect(cover.querySelector<HTMLInputElement>('#aiCache-cover')!.checked).toBe(true);
        expect(cover.textContent).toContain('for 365 days');
        component.patchPurpose('cover', { cache: false });
        component.setDeleteAfter('cover', '30');
        await settle();
        expect(page.querySelector<HTMLInputElement>('#aiCache-cover')!.checked).toBe(false);
        expect(component.purpose('cover')).toMatchObject({ cache: false, deleteAfterDays: 30 });
        component.setDeleteAfter('cover', 5000);
        expect(component.purpose('cover').deleteAfterDays).toBeNull();
        const voice = page.querySelector('.purpose[data-id="voice"]')!;
        expect(voice.querySelector('.files-go')?.textContent).toContain('Files go to app/voice.');
        expect(voice.querySelector('#aiDelete-voice')).toBeNull();
        expect(voice.querySelector('#aiCache-voice')).toBeNull();
        expect(page.querySelector('label[for="aiAllow-menu-scan"]')?.textContent).toContain('(calls)');
        expect(page.querySelector('.purpose[data-id="menu-scan"] .kind-badge')?.textContent).toContain('Data');
    });

    it('prices a model by its unit, warns when it has none, and describes an unknown model by the list it is in', async () => {
        const { page, component, service, settle } = await render({
            connections: { p: { preset: 'pix', keyPreview: '••••3333' } },
            lists: { image: [{ connection: 'p', model: 'pic-1' }, { connection: 'p', model: 'pic-new' }] },
        }, MEDIA);
        expect(component.unpricedNames()).toBe('pic-new');
        component.showAdvanced.set(true);
        await settle();
        const row = page.querySelector('.model-details tr[data-key="p/pic-new"]')!;
        expect(row.querySelector<HTMLSelectElement>('.makes-select')!.value).toBe('image');
        expect(row.querySelector<HTMLSelectElement>('.unit-select')!.value).toBe('pictures');
        expect([...row.querySelectorAll('.price')].map((i) => i.getAttribute('data-field'))).toEqual(['price']);
        expect(row.textContent).toContain('Per picture');
        component.setPrice('p/pic-new', 'price', 0.05);
        await settle();
        expect(component.unpricedNames()).toBe('');
        await component.save();
        expect(service.save.mock.calls[0][0].models['p/pic-new']).toEqual({ makes: 'image', unit: 'pictures', price: 0.05 });
        expect(service.save.mock.calls[0][0].models['p/pic-1']).toBeUndefined();
    });

    it('shows four token prices, cached input and cache write among them, for a text model', async () => {
        const { page, component, settle } = await render({ connections: { p: { preset: 'pix' } }, tiers: { fast: [{ connection: 'p', model: 'chat-1' }] } }, MEDIA);
        component.showAdvanced.set(true);
        await settle();
        const row = page.querySelector('.model-details tr[data-key="p/chat-1"]')!;
        expect([...row.querySelectorAll('.price')].map((i) => i.getAttribute('data-field'))).toEqual(['priceIn', 'priceOut', 'priceCachedIn', 'priceCacheWrite']);
        expect(row.textContent).toContain('Cached input');
        component.setMakes({ connection: 'p', model: 'chat-1', key: 'p/chat-1' }, 'speech');
        expect(component.form().models['p/chat-1']).toEqual({ makes: 'speech' });
        component.setMakes({ connection: 'p', model: 'mine', key: 'p/mine' }, 'video');
        expect(component.form().models['p/mine']).toEqual({ makes: 'video', unit: 'seconds' });
    });

    it('shows usage by kind, and cache hits and cached tokens beside the calls, never added to them', async () => {
        const { page, component, service, settle } = await render({}, MEDIA);
        service.usage.mockResolvedValueOnce(monthUsageFrom('2026-11', {
            calls: 3, cacheHits: 4, tokensIn: 100, tokensCached: 40, pictures: 2, costUsd: 0.1,
            byPurpose: { cover: { calls: 2, cacheHits: 4, pictures: 2, costUsd: 0.08 } },
            byKind: { image: { calls: 2, cacheHits: 4, pictures: 2, costUsd: 0.08 }, text: { calls: 1, tokensCached: 40, costUsd: 0.02 } },
        }, []));
        component.openTab('usage');
        await settle();
        await settle();
        const totals = page.querySelector('.totals')!;
        expect(totals.querySelector('.cache-hits')?.textContent).toContain('Served from cache: 4');
        expect(totals.textContent).toContain('40 of them cached');
        expect(totals.querySelector('.amounts')?.textContent).toContain('2 pictures');
        const kinds = page.querySelector('.usage-table[data-table="admin.settings.ai.by_kind"]')!;
        expect(kinds.textContent).toContain('Pictures');
        expect(kinds.textContent).toContain('From cache');
        expect(kinds.textContent).toContain('Cached input');
        const imageRow = [...kinds.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('Pictures'))!;
        expect([...imageRow.querySelectorAll('td')].map((td) => td.textContent?.trim()).slice(0, 3)).toEqual(['Pictures', '2', '4']);
    });

    it('marks a call\'s kind and a cached call, and shows and plays its files, saying when one was moved', async () => {
        const { page, component, service, settle } = await render({}, MEDIA);
        const call = {
            id: 'f1', createdAt: null, purpose: 'cover', kind: 'image', test: false, outcome: 'ok', connection: 'p', model: 'pic-1', tokensIn: 0, tokensOut: 0, tokensThinking: 0,
            tokensCached: 0, tokensCacheWrite: 0, amount: 2, unit: 'pictures', costUsd: 0, costFrom: 'none', ms: 10, ref: null, limitKey: null, units: 1,
            input: { chars: 10, files: 0, bytes: 0 }, attempts: [], hasContent: false, cached: true, cachedFrom: 'f0',
            files: [{ path: 'ai-files/cover/2026-11/a-1.png', mimeType: 'image/png', bytes: 2048 }, { path: 'ai-files/cover/2026-11/a-2.mp3', mimeType: 'audio/mpeg', bytes: 4096 }, { path: 'ai-files/cover/2026-11/gone.png', mimeType: 'image/png', bytes: 1 }],
        };
        service.recentCalls.mockResolvedValue([call] as never);
        service.aiFileUrl.mockImplementation(async (path: string) => {
            if (path.includes('gone')) throw Object.assign(new Error('That file was moved or deleted.'), { code: 'functions/not-found' });
            return { url: `blob:test/${path}`, contentType: path.endsWith('.png') ? 'image/png' : 'audio/mpeg' };
        });
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
        component.openTab('calls');
        await settle();
        await settle();
        const row = page.querySelector('.call')!;
        expect(row.querySelector('.kind-badge')?.textContent).toContain('Pictures');
        expect(row.querySelector('.from-cache')?.textContent).toContain('From cache');
        expect(row.textContent).toContain('2 pictures');
        await component.toggleCall('f1');
        await settle();
        await settle();
        expect(service.aiFileUrl).toHaveBeenCalledTimes(3);
        const details = page.querySelector('.call-details')!;
        expect(details.querySelector('.cached-from')?.textContent).toContain('call f0');
        expect(details.querySelector<HTMLImageElement>('img.made-picture')?.getAttribute('src')).toBe('blob:test/ai-files/cover/2026-11/a-1.png');
        expect(details.querySelector('audio.made-audio')).not.toBeNull();
        expect(details.querySelector('.made-file[data-path$="gone.png"] .file-gone')?.textContent).toContain('Moved or deleted');
        await component.toggleCall('f1');
        expect(revoke).toHaveBeenCalledWith('blob:test/ai-files/cover/2026-11/a-1.png');
        expect(revoke).toHaveBeenCalledWith('blob:test/ai-files/cover/2026-11/a-2.mp3');
        expect(component.fileViews()).toEqual({});
        revoke.mockRestore();
    });
});

const SPEECH: AiSetupInfo = {
    purposes: [
        { id: 'read', label: 'Read aloud', description: '', tier: 'fast', output: 'text', maxChars: 2000, pictures: null, pdfs: null, perKeyPerDay: null, limitKeyLabel: null, timeoutSeconds: 60, makes: 'speech', allowanceIn: 'calls', saveTo: null, deleteAfterDays: null, cacheDays: 365, fallback: true, arc: false,
            voices: [{ name: 'narrator', ids: { elevenlabs: 'EL_APP' } }, { name: 'guest', ids: {} }] },
        { id: 'arc-voice-sample', label: 'Voice sample', description: 'Plays a sentence in a voice.', tier: 'fast', output: 'text', maxChars: 300, pictures: null, pdfs: null, perKeyPerDay: null, limitKeyLabel: null, timeoutSeconds: 60, makes: 'speech', allowanceIn: 'calls', saveTo: null, deleteAfterDays: 7, cacheDays: 365, fallback: true, arc: true, fixed: true, voices: [] },
    ],
    presets: [
        { id: 'elevenlabs', label: 'ElevenLabs', kind: 'elevenlabs', processesIn: 'The US', needsWorkspace: false, needsAddress: false, reportsCost: false, needsKey: true, testedLive: false, docsReadOn: '2026-11-02', files: 'elevenlabs', makesSpeech: true, makesText: false, readsBalance: true,
            models: [{ model: 'eleven_v4', makes: 'speech', unit: 'characters', reads: [], schema: 'json', price: 0.08, recommend: ['default'], speech: { maxChars: 10000, formats: ['mp3'] } }] },
        { id: 'openrouter', label: 'OpenRouter', kind: 'openai', processesIn: 'Its host', needsWorkspace: false, needsAddress: false, reportsCost: true, makesText: true, models: [{ model: 'qwen/qwen3.8-flash', reads: ['pictures'], schema: 'strict', recommend: ['fast'] }] },
    ],
    pricesCheckedOn: '2026-10-28',
    defaultVertexLocation: 'eu',
};
const eleven = { preset: 'elevenlabs', label: 'ElevenLabs', keyPreview: '••••4321', keySetAt: '2026-11-02T10:00:00Z', lastOkAt: '2026-11-02T10:00:00Z' };

describe('AiSettingsPage, speech and voices (AM2)', () => {
    it('gives a speech provider Voices in place of Test, and lists its voices with Play', async () => {
        const { page, service, settle } = await render({ connections: { eleven, or: working } }, SPEECH);
        const card = page.querySelector('.connection[data-id="eleven"]')!;
        expect(card.querySelector('.test')).toBeNull();
        expect(page.querySelector('.connection[data-id="or"] .voices-button')).toBeNull();
        card.querySelector<HTMLButtonElement>('.voices-button')!.click();
        await settle();
        await settle();
        expect(service.voices).toHaveBeenCalledWith('eleven', false);
        expect(card.querySelector('arc-ai-voices .voice')?.textContent).toContain('Zed');
        expect(card.querySelector('arc-ai-voices .play')).not.toBeNull();
    });

    it('shows each named voice of a speech purpose per provider, the app\'s or the admin\'s, and saves the admin\'s', async () => {
        const { page, component, settle } = await render({ connections: { eleven } }, SPEECH);
        component.tab.set('purposes');
        await settle();
        const read = page.querySelector('.purpose[data-id="read"]')!;
        const narrator = read.querySelector('.voice-name[data-voice="narrator"] .voice-map[data-preset="elevenlabs"]')!;
        expect(narrator.textContent).toContain('EL_APP');
        expect(narrator.textContent).toContain('from the app');
        expect(read.querySelector('.voice-name[data-voice="guest"] .voice-missing')?.textContent).toContain('None chosen');
        component.setVoice('read', 'guest', 'elevenlabs', 'EL_ZED');
        component.setVoice('read', 'narrator', 'elevenlabs', '  EL_OWN ');
        await settle();
        expect(component.form().purposes['read'].voices).toEqual({ guest: { elevenlabs: 'EL_ZED' }, narrator: { elevenlabs: 'EL_OWN' } });
        expect(read.querySelector('.voice-name[data-voice="narrator"]')?.textContent).toContain('chosen here');
        // Taking the admin's back shows the app's again; a bad id is not kept.
        component.setVoice('read', 'narrator', 'elevenlabs', null);
        component.setVoice('read', 'guest', 'elevenlabs', '../bad');
        await settle();
        expect(component.form().purposes['read'].voices).toEqual({});
    });

    it('opens a voice list to choose from, or takes a typed id', async () => {
        const { page, component, settle } = await render({ connections: { eleven } }, SPEECH);
        component.tab.set('purposes');
        await settle();
        page.querySelector<HTMLButtonElement>('.purpose[data-id="read"] .voice-name[data-voice="guest"] .choose-voice')!.click();
        await settle();
        await settle();
        page.querySelector<HTMLButtonElement>('.purpose[data-id="read"] arc-ai-voices .use')!.click();
        await settle();
        expect(component.form().purposes['read'].voices).toEqual({ guest: { elevenlabs: 'EL_ZED' } });
        expect(page.querySelector('.purpose[data-id="read"] arc-ai-voices')).toBeNull();
    });

    it('marks a model not tested live on a provider that is, such as Google\'s speech on Vertex', async () => {
        const vertex = { id: 'vertex', label: 'Google Cloud (Vertex AI)', kind: 'vertex' as const, processesIn: 'The location', needsWorkspace: false, needsAddress: false, reportsCost: false, makesSpeech: true, makesText: true, files: 'vertex',
            models: [{ model: 'gemini-3.8-flash', reads: [], schema: 'strict' as const }, { model: 'tts-chirp3-hd', makes: 'speech' as const, unit: 'characters' as const, reads: [], schema: 'json' as const, price: 0.03, testedLive: false }] };
        const { page } = await render({ connections: { g: { preset: 'vertex', lastOkAt: '2026-11-01T00:00:00Z' } }, lists: { speech: [{ connection: 'g', model: 'tts-chirp3-hd' }] }, tiers: { fast: [{ connection: 'g', model: 'gemini-3.8-flash' }] } }, { ...SPEECH, presets: [vertex] });
        expect(page.querySelector('.connection[data-id="g"] .untested-live')).toBeNull();
        expect(page.querySelector('.tier[data-tier="fast"] .untested-live')).toBeNull();
        expect(page.querySelector('.kind-list[data-kind="speech"] .untested-live')).not.toBeNull();
    });

    it('marks Arc\'s own purpose and needs no models for it', async () => {
        const { page, component, settle } = await render({ mode: 'live', connections: { or: working }, tiers: { fast: [{ connection: 'or', model: 'qwen/qwen3.8-flash' }] }, lists: { speech: [{ connection: 'or', model: 'x' }] } }, { ...SPEECH, purposes: [SPEECH.purposes[1]] });
        // Only Arc's purpose: there is nothing of the app's to set up.
        expect(component.appPurposes()).toEqual([]);
        component.tab.set('purposes');
        await settle();
        const arc = page.querySelector('.purpose[data-id="arc-voice-sample"]')!;
        expect(arc.querySelector('.arc-badge')?.textContent).toContain('Arc CMS');
        expect(arc.querySelector('.arc-note')).not.toBeNull();
        expect(arc.querySelector('select')).toBeNull();
    });

    it('never recommends a speech model to a site that makes no speech, nor over another provider\'s list', async () => {
        const textOnly = { ...SPEECH, purposes: [] };
        const { page } = await render({ connections: { eleven } }, textOnly);
        expect(page.querySelector('.recommend')).toBeNull();
        TestBed.resetTestingModule();
        const filled = await render({ connections: { eleven }, lists: { speech: [{ connection: 'eleven', model: 'eleven_v3' }] } }, SPEECH);
        expect(filled.page.querySelector('.recommend')).toBeNull();
    });

    it('recommends a provider\'s speech model for the speech list, and sets it with the tiers', async () => {
        const { page, component, service, settle } = await render({ connections: { eleven } }, SPEECH);
        expect(page.querySelector('.recommend')?.textContent).toContain('eleven_v4');
        page.querySelector<HTMLButtonElement>('.use-recommended')!.click();
        await settle();
        await settle();
        expect(component.form().lists.speech).toEqual([{ connection: 'eleven', model: 'eleven_v4' }]);
        expect(service.savePart).toHaveBeenCalledWith(expect.objectContaining({ lists: expect.objectContaining({ speech: [{ connection: 'eleven', model: 'eleven_v4' }] }) }));
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

const PRESENTER: AiSetupInfo = {
    purposes: [
        { id: 'host', label: 'Host video', description: '', tier: 'fast', output: 'text', maxChars: 5000, pictures: null, pdfs: null, perKeyPerDay: null, limitKeyLabel: null, timeoutSeconds: 60, makes: 'video', allowanceIn: 'calls', saveTo: null, deleteAfterDays: null, cacheDays: 0, fallback: true, arc: false,
            voices: [], presenter: true, avatars: [{ name: 'host', ids: { heygen: 'look-app' } }, { name: 'guest', ids: {} }], jobTimeoutMinutes: 30 },
    ],
    presets: [
        { id: 'heygen', label: 'HeyGen (presenter videos)', kind: 'heygen', processesIn: 'The US', needsWorkspace: false, needsAddress: false, reportsCost: false, needsKey: true, testedLive: false, docsReadOn: '2026-11-02', files: 'heygen', makesText: false, makesSpeech: false, makesVideo: true, makesPresenters: true, readsBalance: true,
            models: [{ model: 'avatar-iv', makes: 'video', unit: 'seconds', reads: [], schema: 'json', price: 0.0805, recommend: ['default'], job: true, testedLive: false }] },
    ],
    pricesCheckedOn: '2026-10-28',
    defaultVertexLocation: 'eu',
};

describe('AiSettingsPage, presenter videos (AM4)', () => {
    const stored = { mode: 'live', connections: { hg: { preset: 'heygen', keyPreview: '••••1234', lastOkAt: '2026-11-02T00:00:00Z' } }, lists: { video: [{ connection: 'hg', model: 'avatar-iv' }] } };

    it('opens a presenter provider\'s avatars from its card', async () => {
        const { page, component, settle, service } = await render(stored, PRESENTER);
        const button = page.querySelector<HTMLButtonElement>('.connection[data-id="hg"] .avatars-button');
        expect(button).not.toBeNull();
        expect(page.querySelector('.connection[data-id="hg"] .voices-button')).toBeNull();
        component.toggleAvatars('hg');
        await settle();
        await new Promise((r) => setTimeout(r));
        await settle();
        expect(service.avatars).toHaveBeenCalledWith('hg', false);
        expect(page.querySelector('arc-ai-avatars .avatar strong')?.textContent).toBe('Zed');
    });

    it('maps each of a purpose\'s avatars, the admin\'s over the app\'s, and saves it with the page', async () => {
        const { page, component, settle } = await render(stored, PRESENTER);
        component.tab.set('purposes');
        await settle();
        const host = page.querySelector('.avatar-name[data-avatar="host"]')!;
        expect(host.querySelector('code')?.textContent).toBe('look-app');
        expect(page.querySelector('.avatar-name[data-avatar="guest"] .avatar-missing')).not.toBeNull();
        component.setAvatar('host', 'guest', 'heygen', 'look-zed');
        await settle();
        expect(page.querySelector('.avatar-name[data-avatar="guest"] code')?.textContent).toBe('look-zed');
        expect(component.form().purposes['host'].avatars).toEqual({ guest: { heygen: 'look-zed' } });
        component.setAvatar('host', 'guest', 'heygen', null);
        expect(component.form().purposes['host'].avatars).toEqual({});
    });
});
