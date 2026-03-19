import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { RouteMeta } from '@analogjs/router';
import { CreateContentComponent } from '../create-content/create-content.component';
import { roleGuard } from '../../../../guards/role.guard';

export const routeMeta: RouteMeta = {
    title: 'Edit Content | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    selector: 'app-edit-content',
    standalone: true,
    imports: [CommonModule, CreateContentComponent],
    template: `
    <arc-create-content [contentTypeSlug]="slug() || ''" [contentId]="contentId() || ''"></arc-create-content>
  `
})
export default class EditContentPage {
    private route = inject(ActivatedRoute);
    slug = toSignal(this.route.paramMap.pipe(map(params => params.get('slug'))));
    contentId = toSignal(this.route.paramMap.pipe(map(params => params.get('contentId'))));
}
