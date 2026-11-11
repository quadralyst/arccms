import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const en = JSON.parse(readFileSync(resolve(__dirname, '../../../../../assets/i18n/en.json'), 'utf8'));
const transloco = TranslocoTestingModule.forRoot({ langs: { en }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }, preloadLangs: true });
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { DripDrawerComponent } from './drip-drawer.component';
import { DripService, DripCampaign } from '../drip.service';
import { ToastService } from '../../../../../shared/services/toast.service';

describe('DripDrawerComponent', () => {
    let component: DripDrawerComponent;
    let service: {
        createCampaign: ReturnType<typeof vi.fn>;
        saveSteps: ReturnType<typeof vi.fn>;
        updateCampaign: ReturnType<typeof vi.fn>;
    };
    let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        service = {
            createCampaign: vi.fn().mockResolvedValue('new-id'),
            saveSteps: vi.fn().mockResolvedValue(undefined),
            updateCampaign: vi.fn().mockResolvedValue(undefined),
        };
        toast = { success: vi.fn(), error: vi.fn() };

        await TestBed.configureTestingModule({
            imports: [DripDrawerComponent, NoopAnimationsModule, transloco],
            providers: [
                { provide: DripService, useValue: service },
                { provide: ToastService, useValue: toast },
            ],
        }).compileComponents();
        component = TestBed.createComponent(DripDrawerComponent).componentInstance;
    });

    it('creates', () => {
        expect(component).toBeTruthy();
    });

    it('add mode requires a list', async () => {
        component.mode = 'add';
        component.name = 'Onboarding';
        component.listId = '';
        await component.submit();
        expect(service.createCampaign).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith('Pick a list.');
    });

    it('names its icon buttons', async () => {
        const fixture = TestBed.createComponent(DripDrawerComponent);
        fixture.detectChanges();
        fixture.componentInstance.addStep();
        await fixture.whenStable();
        fixture.detectChanges();
        const iconOnly = [...fixture.nativeElement.querySelectorAll('button[mat-icon-button], button.close-btn')] as HTMLButtonElement[];
        expect(iconOnly.length).toBe(3);
        for (const b of iconOnly) expect(b.getAttribute('aria-label')).toBeTruthy();
    });

    it('rejects a step with no template', async () => {
        component.mode = 'add';
        component.name = 'Onboarding';
        component.listId = 'list1';
        component.addStep(); // templateId defaults to ''
        await component.submit();
        expect(service.createCampaign).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalled();
    });

    it('creates a campaign and saves steps, then emits saved + close', async () => {
        const events: string[] = [];
        component.saved.subscribe(() => events.push('saved'));
        component.close.subscribe(() => events.push('close'));
        component.mode = 'add';
        component.name = 'Onboarding';
        component.listId = 'list1';
        component.enrollExisting = true;
        component.addStep();
        component.steps()[0].templateId = 'tmpl1';
        await component.submit();
        expect(service.createCampaign).toHaveBeenCalledWith('Onboarding', 'list1', true);
        expect(service.saveSteps).toHaveBeenCalledWith('new-id', component.steps());
        expect(events).toEqual(['saved', 'close']);
    });

    it('ngOnChanges clones steps so edits stay local until save', () => {
        const campaign: DripCampaign = {
            id: 'c1', name: 'Welcome', listId: 'list1', status: 'draft', trigger: 'list_join',
            steps: [{ id: 's1', templateId: 't1', delayHours: 24 }],
        };
        component.mode = 'edit';
        component.campaign = campaign;
        component.ngOnChanges({
            campaign: {
                currentValue: campaign,
                previousValue: null,
                firstChange: true,
                isFirstChange: () => true,
            },
        });
        component.steps()[0].delayHours = 48;
        // original campaign object must be untouched
        expect(campaign.steps![0].delayHours).toBe(24);
        expect(component.name).toBe('Welcome');
    });

    it('edit mode updates the campaign and saves steps', async () => {
        const campaign: DripCampaign = {
            id: 'c1', name: 'Welcome', listId: 'list1', status: 'active', trigger: 'list_join',
            steps: [{ id: 's1', templateId: 't1', delayHours: 24 }],
        };
        component.mode = 'edit';
        component.campaign = campaign;
        component.ngOnChanges({
            campaign: {
                currentValue: campaign,
                previousValue: null,
                firstChange: true,
                isFirstChange: () => true,
            },
        });
        component.name = 'Welcome v2';
        await component.submit();
        expect(service.updateCampaign).toHaveBeenCalledWith('c1', { name: 'Welcome v2', enrollExistingOnActivate: false });
        expect(service.saveSteps).toHaveBeenCalledWith('c1', component.steps());
        expect(service.createCampaign).not.toHaveBeenCalled();
    });
});
