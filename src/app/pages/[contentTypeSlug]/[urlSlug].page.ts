import { RouteMeta } from '@analogjs/router';
import { featureGuard } from '../../core/features/features';
import { ContentDetailComponent } from '../page.parts/content-detail.component';

export const routeMeta: RouteMeta = {
    title: 'Content Detail | Arc CMS',
    // Any one- or two-segment URL fits this page, so the feature is checked here.
    canActivate: [featureGuard('content')],
};

export default ContentDetailComponent;
