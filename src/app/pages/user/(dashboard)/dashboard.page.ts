import { RouteMeta } from '@analogjs/router';
import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { BaseComponent } from '../../../../shared/components/base/base.component';

export const routeMeta: RouteMeta = {
  title: 'Dashboard | Arc CMS',
  //   ...canActivate(() => redirectUnauthorizedTo(['/auth-checker'])),
};

@Component({
  selector: 'arc-user-dashboard',
  standalone: true,
  imports: [],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export default class UsersDashboardComponent extends BaseComponent { }
