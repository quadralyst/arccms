import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
    Firestore, collection, collectionData, doc, updateDoc, serverTimestamp, query, orderBy,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { roleGuard } from '../../../guards/role.guard';
import { ToastService } from '../../../../shared/services/toast.service';
import { BrandKitService } from '../(email-brand)/brand-kit.service';
import { EmailBlockEditorComponent, BlockEditorSaveEvent } from '../../../../shared/components/email-block-editor/email-block-editor.component';
import { EmailDesign, IEmailBrandKit, DEFAULT_BRAND_KIT } from '../../../../shared/email-compiler/email-design.model';

export const routeMeta: RouteMeta = {
    title: 'Email Composer | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

interface TemplateDoc {
    id: string;
    type: string;
    title?: string;
    subject?: string;
    category?: 'transactional' | 'marketing';
    template?: string;
    design?: EmailDesign;
    editorVersion?: 'html' | 'blocks';
}

@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule,
        MatFormFieldModule, MatSelectModule, EmailBlockEditorComponent,
    ],
    templateUrl: './email-composer.page.html',
})
export default class EmailComposerPageComponent implements OnInit {
    private firestore = inject(Firestore);
    private functions = inject(Functions);
    private brandKitService = inject(BrandKitService);
    private toast = inject(ToastService);

    templates = signal<TemplateDoc[]>([]);
    selectedId = signal<string>('');
    brandKit = signal<IEmailBrandKit>({ ...DEFAULT_BRAND_KIT });

    selected = signal<TemplateDoc | null>(null);
    /** True once a legacy (html) template has been upgraded to a starter block design. */
    upgraded = signal(false);

    ngOnInit(): void {
        this.brandKitService.getBrandKit().subscribe((k) => this.brandKit.set(k));
        const ref = collection(this.firestore, 'EmailTemplate');
        collectionData(query(ref, orderBy('type')), { idField: 'id' }).subscribe((docs) => {
            this.templates.set(docs as TemplateDoc[]);
        });
    }

    get isBlocks(): boolean {
        const t = this.selected();
        return !!t && (t.editorVersion === 'blocks' || this.upgraded());
    }

    get currentDesign(): EmailDesign {
        return this.selected()?.design || { blocks: [] };
    }

    onSelect(id: string): void {
        this.selectedId.set(id);
        this.upgraded.set(false);
        this.selected.set(this.templates().find((t) => t.id === id) || null);
    }

    /** Legacy templates open read-only; upgrading starts a blank block design (no lossy auto-convert). */
    upgradeToBlocks(): void {
        const t = this.selected();
        if (!t) return;
        this.selected.set({
            ...t,
            design: {
                blocks: [
                    { id: 'h', type: 'heading', text: t.title || 'Heading', level: 1 },
                    { id: 'p', type: 'paragraph', html: 'Start writing your email…' },
                ],
            },
        });
        this.upgraded.set(true);
        this.toast.success('Started a block version — edit and save to switch this template to blocks.');
    }

    async onSaved(e: BlockEditorSaveEvent): Promise<void> {
        const t = this.selected();
        if (!t) return;
        try {
            await updateDoc(doc(this.firestore, 'EmailTemplate', t.id), {
                design: e.design as any,
                template: e.html,
                editorVersion: 'blocks',
                modifiedAt: serverTimestamp(),
                modifiedBy: 'admin',
            });
            this.selected.set({ ...t, design: e.design, template: e.html, editorVersion: 'blocks' });
            this.upgraded.set(false);
            this.toast.success('Template saved (design + compiled HTML)');
        } catch (err) {
            console.error(err);
            this.toast.error('Failed to save template');
        }
    }

    async onTestSend(e: BlockEditorSaveEvent): Promise<void> {
        const to = typeof window !== 'undefined' ? window.prompt('Send test email to:') : '';
        if (!to) return;
        try {
            const callable = httpsCallable(this.functions, 'sendTestEmail');
            await callable({ toEmail: to, subject: this.selected()?.subject || 'Test', html: e.html });
            this.toast.success('Test email queued');
        } catch (err) {
            console.error(err);
            this.toast.error('Failed to send test');
        }
    }

    /** Placeholder palette per template type — reuse simple common tags. */
    placeholdersFor(type?: string): string[] {
        const common = ['##NAME##', '##EMAIL##', '##COMPANY_NAME##', '##UNSUBSCRIBE_LINK##', '##PREFERENCES_LINK##'];
        if (type?.includes('otp')) return [...common, '##OTP##'];
        if (type?.includes('payment')) return [...common, '##PAYMENT_AMOUNT##', '##SUBSCRIPTION_PLAN##', '##RENEWAL_DATE##'];
        return common;
    }
}
