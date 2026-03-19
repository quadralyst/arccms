import {
    ChangeDetectionStrategy,
    Component,
    EventEmitter,
    inject,
    input,
    Output,
    signal,
    OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ContentsService } from '../../content-store/published-contents.service';

export interface VersionHistoryItem {
    historyId: string;
    versionNumber: number;
    title: string;
    content: string;
    publishedOn: any;
    coverImage?: string | null;
    tags?: string[];
    tagsWithColors?: { name: string; color: string }[];
    seoTitle?: string;
    metaDescription?: string;
    summary?: string;
    urlSlug?: string;
    customFields?: Record<string, unknown>;
    [key: string]: any;
}

@Component({
    selector: 'arc-version-history',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './version-history.component.html',
    styleUrl: './version-history.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VersionHistoryComponent implements OnInit {
    /** The published document ID (for querying history subcollection) */
    publishedId = input.required<string>();
    /** The content type slug */
    contentTypeSlug = input.required<string>();

    /** Emits the selected version's data when "Restore" is clicked */
    @Output() restore = new EventEmitter<VersionHistoryItem>();

    /** Emits the selected version when clicked for preview in the main area */
    @Output() preview = new EventEmitter<VersionHistoryItem>();

    private contentsService = inject(ContentsService);

    versions = signal<VersionHistoryItem[]>([]);
    selectedVersion = signal<VersionHistoryItem | null>(null);
    isLoading = signal<boolean>(false);
    errorMessage = signal<string>('');

    ngOnInit(): void {
        this.loadHistory();
    }

    loadHistory(): void {
        const pubId = this.publishedId();
        const slug = this.contentTypeSlug();

        if (!pubId || !slug) {
            this.errorMessage.set('No published version found for this content.');
            return;
        }

        this.isLoading.set(true);
        this.errorMessage.set('');

        this.contentsService.getPublishedHistory(pubId, slug).subscribe({
            next: (items) => {
                this.versions.set(items as VersionHistoryItem[]);
                this.isLoading.set(false);
            },
            error: (err) => {
                console.error('Error loading version history:', err);
                this.errorMessage.set('Failed to load version history.');
                this.isLoading.set(false);
            },
        });
    }

    selectVersion(version: VersionHistoryItem): void {
        this.selectedVersion.set(version);
        this.preview.emit(version);
    }

    restoreVersion(version: VersionHistoryItem): void {
        this.restore.emit(version);
    }

    formatDate(date: any): string {
        if (!date) return '';
        const dateObj = date.seconds ? new Date(date.seconds * 1000) : new Date(date);
        if (isNaN(dateObj.getTime())) return '';
        return dateObj.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }
}
