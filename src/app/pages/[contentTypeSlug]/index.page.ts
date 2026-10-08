import { RouteMeta } from '@analogjs/router';
import { featureGuard } from '../../core/features/features';
import { ContentListComponent } from '../page.parts/content-list.component';

export const routeMeta: RouteMeta = {
    // No title: the tab is the site's name until the page names itself (core/brand/brand-title.strategy.ts).
    // Any one- or two-segment URL fits this page, so the feature is checked here.
    canActivate: [featureGuard('content')],
};

export default ContentListComponent;
