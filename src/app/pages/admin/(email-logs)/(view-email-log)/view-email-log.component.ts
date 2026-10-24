import { CommonModule } from '@angular/common';
import { ArcTime } from '../../../../core/time/arc-time.service';
import { ChangeDetectionStrategy, Component, computed, effect, EventEmitter, inject, Injector, Input, Output, runInInjectionContext, signal, untracked, OnChanges, SimpleChanges } from '@angular/core';
import { Storage, getDownloadURL, ref } from '@angular/fire/storage';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { EmailLogStore } from '../email-log.store';
import { fileSize, IEmailLog, sentSubject } from '../email-log.model';

@Component({
    selector: 'arc-view-email-log',
    standalone: true,
    imports: [CommonModule, MatIconModule, MatButtonModule],
    templateUrl: './view-email-log.component.html',
    styleUrl: './view-email-log.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class ViewEmailLogComponent implements OnChanges {
    @Input() id = '';
    @Output() close = new EventEmitter<void>();

    readonly emailLogStore = inject(EmailLogStore);
    private readonly sanitizer = inject(DomSanitizer);
    private readonly arcTime = inject(ArcTime);
    private readonly storage = inject(Storage);
    private readonly injector = inject(Injector);

    log = computed<IEmailLog | null>(() => this.emailLogStore.currentItem() as IEmailLog | null);
    processedHtml = computed<SafeHtml>(() => {
        const item = this.log();
        const html = item?.processedTemplate || item?.template || '';
        return this.sanitizer.bypassSecurityTrustHtml(html);
    });
    readonly sentSubject = sentSubject;
    readonly fileSize = fileSize;
    /** Each stored file's link by its path, 'missing' when it is gone; absent while loading. */
    fileUrls = signal<Record<string, string>>({});
    showRawTemplate = signal(false);
    showTags = signal(false);

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['id'] && this.id) {
            this.emailLogStore.getById(this.id);
        }
    }

    getStatusClass(status?: string): string {
        switch (status) {
            case 'success':
            case 'delivered':
                return 'badge-success';
            case 'sent':
                return 'badge-info';
            case 'failed':
            case 'bounced':
            case 'complained':
            case 'rejected':
                return 'badge-danger';
            default:
                return 'badge-secondary';
        }
    }

    getStatusLabel(status?: string): string {
        if (!status) return 'Pending';
        return status.charAt(0).toUpperCase() + status.slice(1);
    }

    formatDate(date: any): string {
        if (!date) return '-';
        const d = date?.seconds ? new Date(date.seconds * 1000) : new Date(date);
        // The reader's zone, with seconds: a log is read to the second.
        return this.arcTime.format(d, 'medium') || '-';
    }

    formatType(type?: string): string {
        if (!type) return '-';
        return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }

    /** Load the links of the files the email carried (fileUrls), whenever another log opens. */
    private readonly loadFileLinks = effect(() => {
        const files = (this.log()?.attachments ?? []).filter((f) => f.path);
        untracked(() => {
            this.fileUrls.set({});
            for (const file of files) void this.resolveLink(file.path as string);
        });
    });

    /**
     * A file's link, from Storage beside the log (admins may read it there,
     * storage.rules), or 'missing' when it is gone (purged with older logs).
     */
    private async resolveLink(path: string): Promise<void> {
        let url: string;
        try {
            url = await runInInjectionContext(this.injector, () => getDownloadURL(ref(this.storage, path)));
        } catch (err) {
            console.warn('Could not find the attachment', path, err);
            url = 'missing';
        }
        this.fileUrls.update((urls) => ({ ...urls, [path]: url }));
    }

    toggleRawTemplate(): void {
        this.showRawTemplate.update((v) => !v);
    }

    toggleTags(): void {
        this.showTags.update((v) => !v);
    }

    closeDrawer(): void {
        this.close.emit();
    }
}
