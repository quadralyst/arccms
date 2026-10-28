/**
 * Settings, AI (docs/app/ai.html): test mode says what it means; a provider shows where it
 * processes data and only its key's preview; a key can be set only once the provider is
 * saved; purposes come from the app's code; usage and calls load when their tab opens.
 */
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, vi } from 'vitest';
import { AiSettingsPage, recentMonths, usd } from './ai-settings.page';
import { aiFormFrom, AiSettingsService, monthUsageFrom, type AiSetupInfo } from './ai-settings.service';
import { translocoTestingModule } from '../../../../../test/transloco-test-providers';

const SETUP: AiSetupInfo = {
    purposes: [{ id: 'menu-scan', label: 'Menu scan', description: 'Reads a menu photo.', tier: 'thorough', output: 'data', maxChars: 2000, pictures: { max: 5, maxMb: 10 }, pdfs: null, perKeyPerDay: 20, timeoutSeconds: 60 }],
    presets: [
        { id: 'alibaba-eu', label: 'Alibaba Cloud Model Studio, Frankfurt (EU)', kind: 'openai', processesIn: 'Germany (Frankfurt)', needsWorkspace: true, needsAddress: false, reportsCost: false, models: [{ model: 'qwen3-vl-plus', reads: ['pictures'], schema: 'json', priceIn: 0.2, priceOut: 1.6 }] },
        { id: 'openrouter', label: 'OpenRouter', kind: 'openai', processesIn: 'Its host', needsWorkspace: false, needsAddress: false, reportsCost: true, models: [] },
    ],
    pricesCheckedOn: '2026-10-28',
    defaultVertexLocation: 'eu',
};

async function render(stored: Record<string, unknown> = {}) {
    const service = {
        setup: vi.fn(async () => SETUP),
        load: vi.fn(async () => aiFormFrom(stored)),
        save: vi.fn(async () => undefined),
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

describe('AiSettingsPage', () => {
    it('says what test mode means', async () => {
        const { page } = await render();
        expect(page.querySelector('.test-note')?.textContent).toContain('nothing is spent');
        expect(page.querySelector<HTMLSelectElement>('#aiMode')?.value).toBe('test');
    });

    it('shows a saved provider with where it processes data and only its key preview', async () => {
        const { page } = await render({ connections: { qwen: { preset: 'alibaba-eu', label: 'Qwen', workspace: 'ws1', keyPreview: '••••1234', keySetBy: 'a@example.com', keySetAt: '2026-10-01T00:00:00Z' } } });
        const card = page.querySelector('.connection[data-id="qwen"]')!;
        expect(card.textContent).toContain('Processes data in: Germany (Frankfurt)');
        expect(card.textContent).toContain('Key ••••1234, set by a@example.com');
        expect(card.querySelector('input[type="password"]')).not.toBeNull();
        expect(card.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('');
    });

    it('asks to save a new provider before its key', async () => {
        const { page, component, settle } = await render();
        component.newPreset.set('alibaba-eu');
        component.addConnection();
        await settle();
        const card = page.querySelector('.connection')!;
        expect(card.querySelector('input[type="password"]')).toBeNull();
        expect(card.textContent).toContain('Save the page, then set its key.');
    });

    it('saves the page, then the key, and shows the new preview', async () => {
        const { page, component, service, settle } = await render({ connections: { qwen: { preset: 'alibaba-eu', workspace: 'ws1' } } });
        component.setKeyDraft('qwen', '  sk-new-key-9876 ');
        await component.saveKey(component.form().connections[0]);
        await settle();
        expect(service.save).toHaveBeenCalled();
        expect(service.setKey).toHaveBeenCalledWith('qwen', 'sk-new-key-9876');
        expect(page.querySelector('.connection')!.textContent).toContain('••••9876');
        expect(component.keyDrafts()['qwen']).toBe('');
    });

    it('lists the app\'s purposes with what they take, an allowance and the keep content switch', async () => {
        const { page, component, settle } = await render();
        component.openTab('purposes');
        await settle();
        const card = page.querySelector('.purpose[data-id="menu-scan"]')!;
        expect(card.textContent).toContain('Menu scan');
        expect(card.textContent).toContain('up to 5 pictures of 10 MB');
        expect(card.textContent).toContain('Answers with data in a fixed shape');
        expect(card.querySelector<HTMLInputElement>('#aiKeep-menu-scan')!.checked).toBe(false);
        expect(card.querySelector<HTMLInputElement>('#aiAllow-menu-scan')!.placeholder).toBe('20');
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

    it('removes a provider from every list that named it', async () => {
        const { component } = await render({
            connections: { qwen: { preset: 'alibaba-eu' }, router: { preset: 'openrouter', keyPreview: '••••0000' } },
            tiers: { fast: [{ connection: 'router', model: 'x' }, { connection: 'qwen', model: 'qwen3-vl-plus' }] },
            purposes: { 'menu-scan': { models: [{ connection: 'router', model: 'x' }] } },
        });
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        await component.removeConnection(component.form().connections.find((c) => c.id === 'router')!);
        expect(component.form().connections.map((c) => c.id)).toEqual(['qwen']);
        expect(component.form().tiers.fast).toEqual([{ connection: 'qwen', model: 'qwen3-vl-plus' }]);
        expect(component.form().purposes['menu-scan'].models).toEqual([]);
    });
});

describe('usd', () => {
    it('shows fractions of a cent for small sums', () => {
        expect(usd(0)).toBe('$0');
        expect(usd(0.00052)).toBe('$0.0005');
        expect(usd(12.345)).toBe('$12.35');
    });
});
