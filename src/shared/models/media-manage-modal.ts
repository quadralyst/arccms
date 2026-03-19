import { DocumentSnapshot } from '@angular/fire/firestore';

export interface MediaItem {
    id: string;
    url: string;
    name?: string;
    uploadTime?: Date;
}

export interface PaginationInfo {
    pageSize: number;
    totalItems: number;
    lastVisible?: DocumentSnapshot;
}

export interface MediaListResult {
    items: MediaItem[];
    pagination: PaginationInfo;
}
