import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { RouteMeta } from '@analogjs/router';
import { DraftContentsTableComponent } from '../draft-contents-table/draft-contents-table.component';
import { roleGuard } from '../../../../guards/role.guard';

export const routeMeta: RouteMeta = {
  title: 'Contents List | Arc CMS',
  canActivate: [roleGuard],
  data: { allowedRoles: ['admin'] },
};

@Component({
  selector: 'app-contents',
  standalone: true,
  imports: [CommonModule, DraftContentsTableComponent],
  template: `
    <div class="d-flex justify-content-between align-items-center top-bar">
      <h5 class="mb-0">{{ formatSlugAsName(slug()) }}</h5>
    </div>
    @if(slug()){
    <div class="p-4">
      <arc-draft-contents-table
        [contentTypeSlug]="slug() || ''"
      ></arc-draft-contents-table>
    </div>
    }
  `,
})
export default class ContentsPage {
  private route = inject(ActivatedRoute);
  slug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('slug')))
  );

  public formatSlugAsName(slug: any): string {
    if (!slug) return '';
    return slug.charAt(0).toUpperCase() + slug.slice(1);
  }
}
