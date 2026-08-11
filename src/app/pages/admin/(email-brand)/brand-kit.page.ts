import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { roleGuard } from '../../../guards/role.guard';
import { ToastService } from '../../../../shared/services/toast.service';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { BrandKitService } from './brand-kit.service';
import { IEmailBrandKit, DEFAULT_BRAND_KIT, SAFE_FONTS, SocialLink } from '../../../../shared/email-compiler/email-design.model';
import { compileEmailDesign } from '../../../../shared/email-compiler/compiler';
import { EmailDesign } from '../../../../shared/email-compiler/email-design.model';
import { HashtagAutocompleteDirective } from '../../../../shared/directives/hashtag-autocomplete/hashtag-autocomplete.directive';
import { getEmailTags } from '../../../../shared/constants/email-tags';

export const routeMeta: RouteMeta = {
    title: 'Email Brand Kit | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

const SAMPLE: EmailDesign = {
    blocks: [
        { id: '1', type: 'heading', text: 'Your headline here', level: 1 },
        { id: '2', type: 'paragraph', html: 'Hi ##NAME##, this is a live preview of your brand kit. Buttons, colors and the footer all update as you edit.' },
        { id: '3', type: 'button', text: 'Primary button', href: 'https://example.com' },
        { id: '4', type: 'divider' },
    ],
};

const SOCIAL_PLATFORMS: SocialLink['platform'][] = ['x', 'linkedin', 'github', 'youtube', 'instagram', 'facebook'];

@Component({
    standalone: true,
    imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule, MatFormFieldModule, MatSelectModule, PageHeaderComponent, HashtagAutocompleteDirective],
    templateUrl: './brand-kit.page.html',
})
export default class BrandKitPageComponent implements OnInit {
    private service = inject(BrandKitService);
    private toast = inject(ToastService);
    private sanitizer = inject(DomSanitizer);

    fonts = SAFE_FONTS;
    platforms = SOCIAL_PLATFORMS;
    saving = signal(false);

    /** Merge tags offered by the `#` autocomplete in the footer field. */
    footerTags = getEmailTags('brand_kit_footer');

    kit = signal<IEmailBrandKit>({ ...DEFAULT_BRAND_KIT });

    /** Live-compiled preview reflecting the current (unsaved) brand kit. */
    previewHtml = computed<SafeHtml>(() =>
        this.sanitizer.bypassSecurityTrustHtml(compileEmailDesign(SAMPLE, this.kit())),
    );

    ngOnInit(): void {
        this.service.getBrandKit().subscribe((k) => this.kit.set(k));
    }

    update<K extends keyof IEmailBrandKit>(key: K, value: IEmailBrandKit[K]): void {
        this.kit.update((k) => ({ ...k, [key]: value }));
    }

    addSocial(): void {
        this.kit.update((k) => ({ ...k, socialLinks: [...(k.socialLinks || []), { platform: 'x', url: '' }] }));
    }

    removeSocial(i: number): void {
        this.kit.update((k) => ({ ...k, socialLinks: (k.socialLinks || []).filter((_, idx) => idx !== i) }));
    }

    updateSocial(i: number, patch: Partial<SocialLink>): void {
        this.kit.update((k) => ({
            ...k,
            socialLinks: (k.socialLinks || []).map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
        }));
    }

    async save(): Promise<void> {
        this.saving.set(true);
        try {
            await this.service.saveBrandKit(this.kit());
            this.toast.success('Brand kit saved');
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to save brand kit');
        } finally {
            this.saving.set(false);
        }
    }
}
