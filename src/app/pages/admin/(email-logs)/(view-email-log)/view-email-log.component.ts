import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, EventEmitter, inject, Input, Output, signal, OnChanges, SimpleChanges } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { EmailLogStore } from '../email-log.store';
import { IEmailLog } from '../email-log.model';

@Component({
    selector: 'arc-view-email-log',
    standalone: true,
    imports: [CommonModule, MatIconModule, MatButtonModule],
    providers: [DatePipe],
    templateUrl: './view-email-log.component.html',
    styleUrl: './view-email-log.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class ViewEmailLogComponent implements OnChanges {
    @Input() id = '';
    @Output() close = new EventEmitter<void>();

    readonly emailLogStore = inject(EmailLogStore);
    private readonly sanitizer = inject(DomSanitizer);
    private readonly datePipe = inject(DatePipe);

    log = computed<IEmailLog | null>(() => this.emailLogStore.currentItem() as IEmailLog | null);
    processedHtml = computed<SafeHtml>(() => {
        const item = this.log();
        const html = item?.processedTemplate || item?.template || '';
        return this.sanitizer.bypassSecurityTrustHtml(html);
    });
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
        return this.datePipe.transform(d, 'MMM d, y HH:mm:ss') || '-';
    }

    formatType(type?: string): string {
        if (!type) return '-';
        return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
