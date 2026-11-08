import { CommonModule } from '@angular/common';
import { ArcTime } from '../../../../core/time/arc-time.service';
import { ChangeDetectionStrategy, Component, computed, effect, EventEmitter, inject, Injector, Input, Output, runInInjectionContext, signal, untracked, OnChanges, SimpleChanges } from '@angular/core';
import { getDownloadURL, ref } from '@angular/fire/storage';
import { ArcStorage } from '../../../../core/config/arc-storage';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { EmailLogStore } from '../email-log.store';
import { fileSize, IEmailLog, sentSubject } from '../email-log.model';
import { LoaderComponent } from '../../../../../shared/components/loader/loader.component';
import { emailHasRecipientLinks, emailPreviewDocument } from '../../../../../shared/utils/email-preview';

/** How long a file's link may take before the log says it could not be reached. */
const LINK_WAIT_MS = 10_000;

class TimedOut extends Error {}

/** The promise's answer, or a TimedOut error when it takes longer than `ms`. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new TimedOut('no answer')), ms);
        work.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (error) => { clearTimeout(timer); reject(error); },
        );
    });
}

@Component({
    selector: 'arc-view-email-log',
    standalone: true,
    imports: [LoaderComponent, CommonModule, MatIconModule, MatButtonModule],
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
    private readonly arcStorage = inject(ArcStorage);
    private readonly injector = inject(Injector);

    log = computed<IEmailLog | null>(() => this.emailLogStore.currentItem() as IEmailLog | null);
    /** The email as stored: what was sent when the log has it, else the template it was made from. */
    private readonly storedHtml = computed(() => {
        const item = this.log();
        return item?.processedTemplate || item?.template || '';
    });
    /** Whether the log kept any content to show. A frame with nothing in it only looks like a page still loading. */
    readonly hasContent = computed(() => this.storedHtml().trim().length > 0);
    readonly hasRecipientLinks = computed(() => emailHasRecipientLinks(this.storedHtml()));
    processedHtml = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(emailPreviewDocument(this.storedHtml())));
    readonly sentSubject = sentSubject;
    readonly fileSize = fileSize;
    /** Each stored file's link by its path, 'missing' when it is gone, 'unavailable' when Storage did not answer; absent while loading. */
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
            url = await withTimeout(this.linkOf(path), LINK_WAIT_MS);
        } catch (err) {
            // A file that is not there answers at once (object-not-found); one that does not
            // answer within the wait is shown as such, so the line never stays on Loading.
            console.warn('Could not find the attachment', path, err);
            url = err instanceof TimedOut ? 'unavailable' : 'missing';
        }
        this.fileUrls.update((urls) => ({ ...urls, [path]: url }));
    }

    private async linkOf(path: string): Promise<string> {
        const storage = await this.arcStorage.get();
        return runInInjectionContext(this.injector, () => getDownloadURL(ref(storage, path)));
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
