import { describe, it, expect } from 'vitest';
import { instanceLabelFor } from './signup.page';

describe('the project line in the sign-in footer (F26)', () => {
    it('shows the project and database to a developer running npm run dev', () => {
        expect(instanceLabelFor(true, false, 'my-dev', '(default)')).toBe('my-dev · (default) database');
    });

    it('is empty in every built site, even a dev project\'s that testers and clients use', () => {
        expect(instanceLabelFor(false, false, 'my-dev', '(default)')).toBe('');
        expect(instanceLabelFor(false, true, 'my-dev', '(default)')).toBe('');
    });

    it('is empty in a production build run in dev mode', () => {
        expect(instanceLabelFor(true, true, 'my-dev', '(default)')).toBe('');
    });
});
