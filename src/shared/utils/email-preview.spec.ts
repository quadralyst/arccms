import { describe, expect, it } from 'vitest';
import { emailHasLinks, emailPreviewDocument } from './email-preview';

describe('emailPreviewDocument', () => {
    it('sends every link to a new window, which the sandbox refuses, so the email stays', () => {
        expect(emailPreviewDocument('<p><a href="/admin/reports">Open</a></p>')).toBe('<base target="_blank"><p><a href="/admin/reports">Open</a></p>');
    });

    it('goes in the head of a full document, and never before a doctype', () => {
        expect(emailPreviewDocument('<!DOCTYPE html><html><head><title>x</title></head></html>'))
            .toBe('<!DOCTYPE html><html><head><base target="_blank"><title>x</title></head></html>');
        expect(emailPreviewDocument('<!doctype html><p>x</p>')).toBe('<!doctype html><base target="_blank"><p>x</p>');
    });

    it('does not take a <header> for the head', () => {
        expect(emailPreviewDocument('<header>x</header>')).toBe('<base target="_blank"><header>x</header>');
    });

    it('overrides a link that asks to stay in the frame', () => {
        expect(emailPreviewDocument('<a href="/x" target="_self">x</a>')).toContain('target="_blank">x</a>');
        expect(emailPreviewDocument("<a href='/x' target='_self'>x</a>")).not.toContain('_self');
    });
});

describe('emailHasLinks', () => {
    it('finds a link, and not an anchor without one or a word in the text', () => {
        expect(emailHasLinks('<p><a class="b" href="https://example.test">x</a></p>')).toBe(true);
        expect(emailHasLinks('<a name="top"></a><p>a href= in words</p>')).toBe(false);
    });
});
