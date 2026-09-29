import { RouteMeta } from '@analogjs/router';
import { featureGuard } from '../../core/features/features';
import { ContentListComponent } from '../page.parts/content-list.component';

export const routeMeta: RouteMeta = {
    title: 'Content List | Arc CMS',
    // Any one- or two-segment URL fits this page, so the feature is checked here.
    canActivate: [featureGuard('content')],
};

export default ContentListComponent;
