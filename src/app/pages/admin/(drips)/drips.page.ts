import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { roleGuard } from '../../../guards/role.guard';
import { ToastService } from '../../../../shared/services/toast.service';
import { DripService, DripCampaign, DripStep, TemplateOption } from './drip.service';
import { AudienceService } from '../(audience)/audience.service';
import { IList } from '../(audience)/audience.model';

export const routeMeta: RouteMeta = {
    title: 'Drip Campaigns | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule,
        MatFormFieldModule, MatSelectModule, MatSlideToggleModule,
    ],
    templateUrl: './drips.page.html',
})
export default class DripsPageComponent implements OnInit {
    private service = inject(DripService);
    private audience = inject(AudienceService);
    private toast = inject(ToastService);

    campaigns = signal<DripCampaign[]>([]);
    lists = signal<IList[]>([]);
    templates = signal<TemplateOption[]>([]);

    // New campaign form
    newName = '';
    newListId = '';
    newEnrollExisting = false;

    ngOnInit(): void {
        this.service.watchCampaigns().pipe(takeUntilDestroyed()).subscribe((c) => this.campaigns.set(c));
        this.audience.getLists().pipe(takeUntilDestroyed()).subscribe((l) => this.lists.set(l));
        this.service.watchTemplates().pipe(takeUntilDestroyed()).subscribe((t) => this.templates.set(t));
    }

    listName(id: string): string {
        return this.lists().find((l) => l.id === id)?.name || id;
    }

    async create(): Promise<void> {
        if (!this.newName.trim() || !this.newListId) { this.toast.error('Name and list are required'); return; }
        try {
            await this.service.createCampaign(this.newName.trim(), this.newListId, this.newEnrollExisting);
            this.newName = ''; this.newListId = ''; this.newEnrollExisting = false;
            this.toast.success('Campaign created (draft)');
        } catch (e) { console.error(e); this.toast.error('Failed to create campaign'); }
    }

    addStep(c: DripCampaign): void {
        const steps = [...(c.steps || []), { id: 'step_' + Date.now(), templateId: '', delayHours: 24 } as DripStep];
        c.steps = steps;
    }

    removeStep(c: DripCampaign, i: number): void {
        c.steps = (c.steps || []).filter((_, idx) => idx !== i);
    }

    async saveSteps(c: DripCampaign): Promise<void> {
        if ((c.steps || []).some((s) => !s.templateId)) { this.toast.error('Every step needs a template'); return; }
        try { await this.service.saveSteps(c.id, c.steps || []); this.toast.success('Steps saved'); }
        catch (e) { console.error(e); this.toast.error('Failed to save steps'); }
    }

    async activate(c: DripCampaign): Promise<void> {
        try {
            const res: any = await this.service.activate(c.id);
            this.toast.success(`Activated${res?.data?.enrolled ? ` — enrolled ${res.data.enrolled}` : ''}`);
        } catch (e) { console.error(e); this.toast.error('Failed to activate'); }
    }

    async pause(c: DripCampaign): Promise<void> {
        try { await this.service.setStatus(c.id, 'paused'); this.toast.success('Paused'); }
        catch (e) { console.error(e); this.toast.error('Failed to pause'); }
    }

    async resume(c: DripCampaign): Promise<void> {
        try { await this.service.setStatus(c.id, 'active'); this.toast.success('Resumed'); }
        catch (e) { console.error(e); this.toast.error('Failed to resume'); }
    }

    async archive(c: DripCampaign): Promise<void> {
        try { await this.service.archive(c.id); this.toast.success('Archived — active enrollments exited'); }
        catch (e) { console.error(e); this.toast.error('Failed to archive'); }
    }
}
