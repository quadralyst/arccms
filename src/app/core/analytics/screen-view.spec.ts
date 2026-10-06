import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component } from '@angular/core';
import type { ActivatedRouteSnapshot } from '@angular/router';
import { ScreenViewSequence, screenOf, SCREEN_VIEW_EVENT } from './screen-view';

@Component({ selector: 'app-lesson', template: '' })
class Lesson {}

function root(path: string): ActivatedRouteSnapshot {
    const child = { routeConfig: { path }, component: Lesson, firstChild: null } as unknown as ActivatedRouteSnapshot;
    const top = { routeConfig: null, component: null, firstChild: child } as unknown as ActivatedRouteSnapshot;
    (child as unknown as { pathFromRoot: unknown[] }).pathFromRoot = [top, child];
    (top as unknown as { pathFromRoot: unknown[] }).pathFromRoot = [top];
    return top;
}

describe('screen views (docs/features/analytics.html)', () => {
    it('uses every parameter name AngularFire\'s ScreenTrackingService uses', () => {
        const source = readFileSync(resolve(__dirname, '../../../../node_modules/@angular/fire/fesm2022/angular-fire-analytics.mjs'), 'utf8');
        const theirs = [...source.matchAll(/const \w+_KEY = '([a-z_]+)';/g)].map((m) => m[1]);
        expect(theirs.length).toBeGreaterThan(8);
        expect(source).toContain(`const SCREEN_VIEW_EVENT = '${SCREEN_VIEW_EVENT}'`);

        const sequence = new ScreenViewSequence();
        sequence.next(screenOf(root('home'), '/home', 'Home'));
        const second = sequence.next(screenOf(root('lessons/:id'), '/lessons/7', 'Lesson'))!;
        expect(Object.keys(second).sort()).toEqual([...new Set(theirs)].sort());
    });

    it('names the screen by its route pattern and class by the component selector', () => {
        const screen = screenOf(root('lessons/:id'), '/lessons/7', 'Lesson 7');
        expect(screen).toMatchObject({
            screen_name: 'lessons/:id', firebase_screen: 'lessons/:id', page_path: '/lessons/7',
            page_title: 'Lesson 7', screen_class: 'app-lesson', firebase_screen_class: 'app-lesson', firebase_event_origin: 'auto',
        });
    });

    it('numbers screens, adds the previous one, and skips a repeat of the same screen', () => {
        const sequence = new ScreenViewSequence();
        const first = sequence.next(screenOf(root('home'), '/home', 'Home'))!;
        expect(first['firebase_previous_screen']).toBeUndefined();
        expect(sequence.next(screenOf(root('home'), '/home', 'Home'))).toBeNull();
        const second = sequence.next(screenOf(root('about'), '/about', 'About'))!;
        expect(second['firebase_previous_screen']).toBe('home');
        expect(second['firebase_previous_id']).toBe(first['firebase_screen_id']);
    });
});
