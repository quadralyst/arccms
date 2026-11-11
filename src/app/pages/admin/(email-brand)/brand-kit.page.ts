import { RouteMeta } from '@analogjs/router';
import { PreviewLinksDirective } from '../../../../shared/directives/preview-links/preview-links.directive';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, merge, scan } from 'rxjs';
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
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { injectT } from '../../../core/i18n/inject-t';

export const routeMeta: RouteMeta = {
    title: 'Brand kit',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

const SOCIAL_PLATFORMS: SocialLink['platform'][] = ['x', 'linkedin', 'github', 'youtube', 'instagram', 'facebook'];

/** Each platform by its own name. */
const PLATFORM_NAMES: Record<string, string> = {
    x: 'X', linkedin: 'LinkedIn', github: 'GitHub', youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook',
};

@Component({
    standalone: true,
    imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule, MatFormFieldModule, MatSelectModule, PageHeaderComponent, HashtagAutocompleteDirective, PreviewLinksDirective, TranslocoPipe],
    templateUrl: './brand-kit.page.html',
})
export default class BrandKitPageComponent implements OnInit {
    private service = inject(BrandKitService);
    private toast = inject(ToastService);
    private sanitizer = inject(DomSanitizer);
    private readonly t = injectT();

    fonts = SAFE_FONTS;
    platforms = SOCIAL_PLATFORMS;
    saving = signal(false);
    /** True once the saved kit is in. Saving before that would replace it with the default. */
    loaded = signal(false);
    /** Set when the saved kit did not load: the page says so and offers Retry. */
    loadError = signal(false);

    /** Merge tags offered by the `#` autocomplete in the footer field. */
    footerTags = getEmailTags('brand_kit_footer');

    kit = signal<IEmailBrandKit>({ ...DEFAULT_BRAND_KIT });

    /**
     * Changes when the admin's language changes or a translation file arrives. The sample
     * words come from a synchronous translate(), which a computed does not track by itself:
     * without this the preview kept the old language, or the bare keys of a late file.
     */
    private readonly words = toSignal(
        merge(
            inject(TranslocoService).langChanges$,
            inject(TranslocoService).events$.pipe(filter((event) => event.type === 'translationLoadSuccess')),
        ).pipe(scan((n) => n + 1, 0)),
        { initialValue: 0 },
    );

    /** Live-compiled preview reflecting the current (unsaved) brand kit, with sample words in the admin's language. */
    previewHtml = computed<SafeHtml>(() => {
        this.words();
        return this.sanitizer.bypassSecurityTrustHtml(compileEmailDesign(this.sample(), this.kit()));
    });

    ngOnInit(): void {
        this.load();
    }

    /** Read the saved kit. Retry calls it again after a failed read. */
    load(): void {
        this.loadError.set(false);
        this.service.getBrandKit({ surfaceErrors: true }).subscribe({
            next: (k) => {
                this.kit.set(k);
                this.loaded.set(true);
            },
            // The service logged the detail.
            error: () => this.loadError.set(true),
        });
    }

    private sample(): EmailDesign {
        return {
            blocks: [
                { id: '1', type: 'heading', text: this.t('admin.email_brand.sample_heading'), level: 1 },
                { id: '2', type: 'paragraph', html: this.t('admin.email_brand.sample_text') },
                { id: '3', type: 'button', text: this.t('admin.email_brand.sample_button'), href: 'https://example.com' },
                { id: '4', type: 'divider' },
            ],
        };
    }

    platformName(platform: string): string {
        return PLATFORM_NAMES[platform] ?? platform;
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
        if (!this.loaded()) return;
        this.saving.set(true);
        try {
            await this.service.saveBrandKit(this.kit());
            this.toast.success(this.t('admin.email_brand.saved'));
        } catch (e) {
            console.error(e);
            this.toast.error(this.t('admin.email_brand.save_failed'));
        } finally {
            this.saving.set(false);
        }
    }
}
