import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { roleGuard } from '../../../guards/role.guard';
import { ToastService } from '../../../../shared/services/toast.service';
import { AudienceService } from '../(audience)/audience.service';
import { IList } from '../(audience)/audience.model';

export const routeMeta: RouteMeta = {
    title: 'Lists | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule, MatFormFieldModule],
    templateUrl: './lists.page.html',
})
export default class ListsPageComponent implements OnInit {
    private audience = inject(AudienceService);
    private toast = inject(ToastService);

    lists = signal<IList[]>([]);
    newListName = '';
    creating = signal(false);

    ngOnInit(): void {
        this.audience.getLists()
            .pipe(takeUntilDestroyed())
            .subscribe((lists) => this.lists.set(lists));
    }

    async createList(): Promise<void> {
        const name = this.newListName.trim();
        if (!name) return;
        this.creating.set(true);
        try {
            await this.audience.createList(name);
            this.newListName = '';
            this.toast.success('List created');
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to create list');
        } finally {
            this.creating.set(false);
        }
    }

    async deleteList(list: IList): Promise<void> {
        if (list.type === 'system') {
            this.toast.error('System lists cannot be deleted');
            return;
        }
        try {
            await this.audience.deleteList(list.id);
            this.toast.success('List deleted');
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to delete list');
        }
    }
}
