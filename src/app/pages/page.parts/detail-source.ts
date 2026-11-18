/**
 * Where a content page's entry comes from (specs/visual-editing-spec.md, VE-D4).
 *
 * The detail page reads its type, address, language and the `?preview=true`
 * flag from its route, and loads the entry from Firestore. The live preview
 * (`/admin/preview/:type/:id`) hosts the same component with the editor's
 * unsaved draft instead, by providing a DetailSource whose `live` signal it
 * fills from the preview channel.
 */
import { Signal } from '@angular/core';
import { ActivatedRouteSnapshot } from '@angular/router';
import { IContentTranslation } from '../admin/contents/draft-content-store/content-translation.model';

/** What the page's route says it shows. */
export interface DetailRoute {
    typeSlug: string;
    urlSlug: string;
    /** `?preview=true`: the saved draft rather than the published entry. */
    preview: boolean;
    /** The language prefix, '' for the default language. */
    lang: string;
}

/** An entry handed to the page rather than loaded: the editor's draft. */
export interface LiveDetail {
    /** The draft as a save would write it, with its id. */
    content: Record<string, any>;
    /** The language on screen, '' for the default language. */
    lang: string;
    /** That language's unsaved values, when it is a translation. */
    translation: IContentTranslation | null;
}

export abstract class DetailSource {
    abstract route(): DetailRoute;
    /** Set for a page drawn from data handed to it; the page then loads no entry itself. */
    readonly live?: Signal<LiveDetail | null>;
    /** Mark every element a value filled, for click to field (VE-D7). */
    readonly markFields?: boolean;
}

/** The default: the route's parameters, as the detail page has always read them. */
export class RouteDetailSource extends DetailSource {
    constructor(private snapshot: ActivatedRouteSnapshot) {
        super();
    }

    route(): DetailRoute {
        return {
            typeSlug: this.snapshot.paramMap.get('contentTypeSlug') || '',
            urlSlug: this.snapshot.paramMap.get('urlSlug') || '',
            preview: this.snapshot.queryParamMap.get('preview') === 'true',
            // Present only on the /{lang}/... routes; absent means default language.
            lang: this.snapshot.paramMap.get('lang') || '',
        };
    }
}
