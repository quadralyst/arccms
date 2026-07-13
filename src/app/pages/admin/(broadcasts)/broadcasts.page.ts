import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
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
import { BroadcastService, BroadcastAudience, BroadcastRow } from './broadcast.service';
import { AudienceService } from '../(audience)/audience.service';
import { IList } from '../(audience)/audience.model';
import { BrandKitService } from '../(email-brand)/brand-kit.service';
import { EmailBlockEditorComponent, BlockEditorSaveEvent } from '../../../../shared/components/email-block-editor/email-block-editor.component';
import { IEmailBrandKit, DEFAULT_BRAND_KIT, EmailDesign } from '../../../../shared/email-compiler/email-design.model';
import { Functions, httpsCallable } from '@angular/fire/functions';

export const routeMeta: RouteMeta = {
    title: 'Broadcasts | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule,
        MatFormFieldModule, MatSelectModule, MatSlideToggleModule, EmailBlockEditorComponent,
    ],
    templateUrl: './broadcasts.page.html',
})
export default class BroadcastsPageComponent implements OnInit {
    private service = inject(BroadcastService);
    private audience = inject(AudienceService);
    private brandKitService = inject(BrandKitService);
    private functions = inject(Functions);
    private toast = inject(ToastService);
    private destroyRef = inject(DestroyRef);

    lists = signal<IList[]>([]);
    recent = signal<BroadcastRow[]>([]);
    brandKit = signal<IEmailBrandKit>({ ...DEFAULT_BRAND_KIT });

    // Composer state
    subject = '';
    listId = '';
    premiumType = '';
    schedule = false;
    scheduledAt = '';
    private content: BlockEditorSaveEvent | null = null;

    eligible = signal<number | null>(null);
    previewing = signal(false);
    sending = signal(false);

    starterDesign: EmailDesign = { blocks: [
        { id: 'h', type: 'heading', text: 'Big news', level: 1 },
        { id: 'p', type: 'paragraph', html: 'Hi ##NAME##, here is what is new…' },
    ] };

    ngOnInit(): void {
        this.audience.getLists().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((l) => this.lists.set(l));
        this.service.watchRecent().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((r) => this.recent.set(r));
        this.brandKitService.getBrandKit().subscribe((k) => this.brandKit.set(k));
    }

    private buildAudience(): BroadcastAudience {
        const audience: BroadcastAudience = { kind: 'list', listId: this.listId };
        if (this.premiumType.trim()) {
            audience.filters = [{ field: 'premiumType', op: '==', value: this.premiumType.trim() }];
        }
        return audience;
    }

    async preview(): Promise<void> {
        if (!this.listId) { this.toast.error('Pick a list first'); return; }
        this.previewing.set(true);
        try {
            const res = await this.service.previewAudience(this.buildAudience());
            this.eligible.set(res.data.eligible);
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to preview audience');
        } finally {
            this.previewing.set(false);
        }
    }

    onContentSaved(e: BlockEditorSaveEvent): void {
        this.content = e;
        this.toast.success('Content captured — ready to send');
    }

    async onTestSend(e: BlockEditorSaveEvent): Promise<void> {
        const to = typeof window !== 'undefined' ? window.prompt('Send test to:') : '';
        if (!to) return;
        try {
            await httpsCallable(this.functions, 'sendTestEmail')({ toEmail: to, subject: this.subject || 'Test broadcast', html: e.html });
            this.toast.success('Test queued');
        } catch (err) {
            console.error(err);
            this.toast.error('Failed to send test');
        }
    }

    async send(): Promise<void> {
        if (!this.subject.trim()) { this.toast.error('Add a subject'); return; }
        if (!this.listId) { this.toast.error('Pick a list'); return; }
        if (!this.content) { this.toast.error('Click Save in the editor to capture content first'); return; }
        this.sending.set(true);
        try {
            const scheduledAt = this.schedule && this.scheduledAt ? new Date(this.scheduledAt) : null;
            await this.service.createBroadcast({
                subject: this.subject,
                html: this.content.html,
                audience: this.buildAudience(),
                scheduledAt,
            });
            this.toast.success(scheduledAt ? 'Broadcast scheduled' : 'Broadcast queued');
            this.subject = ''; this.content = null; this.eligible.set(null);
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to create broadcast');
        } finally {
            this.sending.set(false);
        }
    }

    async cancel(row: BroadcastRow): Promise<void> {
        try {
            await this.service.cancel(row.id);
            this.toast.success('Broadcast cancelled');
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to cancel');
        }
    }
}
