/**
 * Tests for the public language switcher.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LanguageSwitcherComponent } from './language-switcher.component';
import { LocalizationService } from '../../core/services/localization.service';

const ENGLISH = { code: 'en', label: 'English', nativeLabel: 'English' };
const HINDI = { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' };

describe('LanguageSwitcherComponent', () => {
    let fixture: ComponentFixture<LanguageSwitcherComponent>;
    let component: LanguageSwitcherComponent;
    let localization: any;
    let router: any;

    function build(url: string, languages = [ENGLISH, HINDI], defaultLang = 'en') {
        localization = {
            load: vi.fn().mockResolvedValue(undefined),
            enabledLanguages: signal(languages),
            defaultLanguage: signal(defaultLang),
        };
        router = { url, events: of() };

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [LanguageSwitcherComponent],
            providers: [
                { provide: LocalizationService, useValue: localization },
                { provide: Router, useValue: router },
            ],
        });

        fixture = TestBed.createComponent(LanguageSwitcherComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    }

    beforeEach(() => build('/articles/my-post'));

    it('renders one link per enabled language', () => {
        expect(component.links().map(l => l.code)).toEqual(['en', 'hi']);
    });

    it('uses the endonym as the label', () => {
        expect(component.links().find(l => l.code === 'hi')?.label).toBe('हिन्दी');
    });

    it('keeps the default language unprefixed and prefixes the rest', () => {
        const links = component.links();
        expect(links.find(l => l.code === 'en')?.url).toBe('/articles/my-post');
        expect(links.find(l => l.code === 'hi')?.url).toBe('/hi/articles/my-post');
    });

    it('marks the default language current on an unprefixed URL', () => {
        expect(component.links().find(l => l.code === 'en')?.isCurrent).toBe(true);
        expect(component.links().find(l => l.code === 'hi')?.isCurrent).toBe(false);
    });

    it('strips an existing prefix when building sibling URLs', () => {
        build('/hi/articles/my-post');

        const links = component.links();
        expect(links.find(l => l.code === 'en')?.url).toBe('/articles/my-post');
        expect(links.find(l => l.code === 'hi')?.url).toBe('/hi/articles/my-post');
        expect(links.find(l => l.code === 'hi')?.isCurrent).toBe(true);
    });

    it('handles the site root', () => {
        build('/');

        expect(component.links().find(l => l.code === 'en')?.url).toBe('/');
        expect(component.links().find(l => l.code === 'hi')?.url).toBe('/hi');
    });

    it('ignores query strings and fragments', () => {
        build('/articles/my-post?preview=true#section');

        expect(component.links().find(l => l.code === 'hi')?.url).toBe('/hi/articles/my-post');
    });

    it('renders nothing on a single-language site', () => {
        build('/articles/my-post', [ENGLISH]);

        expect(component.links()).toEqual([]);
        expect(fixture.nativeElement.querySelector('.arc-lang-switcher')).toBeNull();
    });

    it('renders the links once there is more than one language', () => {
        const anchors = fixture.nativeElement.querySelectorAll('.arc-lang-link');
        expect(anchors).toHaveLength(2);
    });

    it('does not treat the default language prefix as a prefix', () => {
        // /en/... is not a route the site serves; the first segment is content.
        build('/en/articles');

        expect(component.links().find(l => l.code === 'hi')?.url).toBe('/hi/en/articles');
    });

    it('remembers the chosen language', () => {
        const setItem = vi.fn();
        vi.stubGlobal('localStorage', { setItem });

        component.remember('hi');

        expect(setItem).toHaveBeenCalledWith('arc-lang', 'hi');
        vi.unstubAllGlobals();
    });

    it('survives storage being unavailable', () => {
        vi.stubGlobal('localStorage', {
            setItem: () => { throw new Error('quota'); },
        });

        // Navigation must never be blocked by a failed preference write.
        expect(() => component.remember('hi')).not.toThrow();
        vi.unstubAllGlobals();
    });
});
