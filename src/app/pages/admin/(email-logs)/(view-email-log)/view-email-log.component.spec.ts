/**
 * The email log's detail ends in every case: the content, a plain message that none was
 * stored, and for a file its link, "No longer stored", or that it could not be reached.
 * It never stays on "Loading...".
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArcTime } from '../../../../core/time/arc-time.service';
import { ArcStorage } from '../../../../core/config/arc-storage';
import { EmailLogStore } from '../email-log.store';
import ViewEmailLogComponent from './view-email-log.component';

const getDownloadURL = vi.fn();
vi.mock('@angular/fire/storage', () => ({ getDownloadURL: (...a: unknown[]) => getDownloadURL(...a), ref: (_s: unknown, p: string) => ({ path: p }) }));

describe('ViewEmailLogComponent', () => {
    const item = signal<Record<string, unknown> | null>(null);
    let storageGet: ReturnType<typeof vi.fn>;

    function open() {
        const fixture = TestBed.createComponent(ViewEmailLogComponent);
        fixture.detectChanges();
        return fixture;
    }

    beforeEach(() => {
        item.set(null);
        getDownloadURL.mockReset();
        storageGet = vi.fn(() => Promise.resolve({}));
        TestBed.configureTestingModule({
            imports: [ViewEmailLogComponent],
            providers: [
                { provide: EmailLogStore, useValue: { currentItem: item, getById: vi.fn() } },
                { provide: ArcStorage, useValue: { get: storageGet } },
                { provide: ArcTime, useValue: { format: () => 'a time' } },
            ],
        });
    });

    afterEach(() => vi.useRealTimers());

    it('shows the stored email in a frame', () => {
        item.set({ status: 'success', processedTemplate: '<p>Hello</p>' });
        const fixture = open();
        expect(fixture.nativeElement.querySelector('iframe.email-preview')).toBeTruthy();
        expect(fixture.nativeElement.textContent).not.toContain('was not stored');
        expect(fixture.nativeElement.textContent).not.toContain('Links do not open');
    });

    it('keeps a link from replacing the email in its frame, and says links do not open', () => {
        // The review's "Loading...": a link followed in the sandboxed frame loads the app there
        // with no scripts and no stylesheet, for good.
        item.set({ status: 'success', processedTemplate: '<p><a href="/admin/reports">Open it in Reports</a></p>' });
        const fixture = open();
        const frame = fixture.nativeElement.querySelector('iframe.email-preview') as HTMLIFrameElement;
        expect(frame.getAttribute('sandbox')).toBe('');
        expect(frame.getAttribute('srcdoc')).toMatch(/^<base target="_blank">/);
        expect(fixture.nativeElement.textContent).toContain('Links do not open from this preview.');
    });

    it('says plainly that no content was stored, instead of an empty frame', () => {
        item.set({ status: 'success', processedTemplate: '  ', template: '' });
        const fixture = open();
        expect(fixture.nativeElement.querySelector('iframe.email-preview')).toBeNull();
        expect(fixture.nativeElement.textContent).toContain('The content of this email was not stored');
    });

    it('ends a file whose link never comes, with a message, not Loading', async () => {
        vi.useFakeTimers();
        storageGet.mockReturnValue(new Promise(() => undefined));
        item.set({ status: 'success', processedTemplate: '<p>x</p>', attachments: [{ name: 'a.csv', contentType: 'text/csv', size: 3, path: 'email-logs/1/a.csv' }] });
        const fixture = open();
        TestBed.tick();
        expect(fixture.nativeElement.textContent).toContain('Loading...');
        await vi.advanceTimersByTimeAsync(10_500);
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).not.toContain('Loading...');
        expect(fixture.nativeElement.textContent).toContain('Could not reach the file');
    });

    it('says a file that is gone is no longer stored', async () => {
        getDownloadURL.mockRejectedValue(new Error('object-not-found'));
        item.set({ status: 'success', processedTemplate: '<p>x</p>', attachments: [{ name: 'a.csv', contentType: 'text/csv', size: 3, path: 'email-logs/1/a.csv' }] });
        const fixture = open();
        TestBed.tick();
        await fixture.whenStable();
        await new Promise((r) => setTimeout(r, 0));
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('No longer stored');
    });
});
