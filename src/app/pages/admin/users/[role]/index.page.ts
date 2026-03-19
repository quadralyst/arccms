import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { RouteMeta } from '@analogjs/router';
import UsersListComponent from '../index.page';
import { roleGuard } from '../../../../guards/role.guard';

export const routeMeta: RouteMeta = {
    title: 'Users by Role | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    selector: 'app-users-by-role',
    standalone: true,
    imports: [CommonModule, UsersListComponent],
    template: `<arc-users></arc-users>`
})
export default class UsersByRolePage {
    private route = inject(ActivatedRoute);
    role = toSignal(this.route.paramMap.pipe(map(params => params.get('role'))));
}
