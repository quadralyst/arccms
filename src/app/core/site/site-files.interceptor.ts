/**
 * Versions the links in every site page the app fetches: the home page, content
 * templates and static pages from /_site/ (specs/own-website-spec.md). They are
 * the same files the publish functions turn into pages, and those pages link
 * the app's own files (/site/home.css, /site/hero.webp) with `?v={hash}`, so the
 * preview does too (versionSiteUrls). Hosting lets browsers keep CSS, scripts
 * and images for a year; an unversioned link would show an old file.
 */
import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { map } from 'rxjs';
import { siteManifest } from './site';
import { versionSiteUrls } from './site-urls';

const SITE_PAGE = /^\/_site\/.+\.html$/;

export const siteFilesInterceptor: HttpInterceptorFn = (req, next) => {
    // By path: an interceptor before this one may have made the URL absolute.
    if (req.method !== 'GET' || req.responseType !== 'text' || !SITE_PAGE.test(new URL(req.url, 'http://site').pathname)) return next(req);
    return next(req).pipe(map((event) => (event instanceof HttpResponse && typeof event.body === 'string'
        ? event.clone({ body: versionSiteUrls(event.body, siteManifest().files) })
        : event)));
};
