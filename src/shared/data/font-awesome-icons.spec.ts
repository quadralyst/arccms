import { FONT_AWESOME_ICONS } from './font-awesome-icons';

describe('FONT_AWESOME_ICONS', () => {
    it('should be defined', () => {
        expect(FONT_AWESOME_ICONS).toBeDefined();
    });

    it('should be an array', () => {
        expect(Array.isArray(FONT_AWESOME_ICONS)).toBe(true);
    });

    it('should not be empty', () => {
        expect(FONT_AWESOME_ICONS.length).toBeGreaterThan(0);
    });

    it('should contain icon objects with name and class', () => {
        FONT_AWESOME_ICONS.forEach(icon => {
            expect(icon).toHaveProperty('name');
            expect(icon).toHaveProperty('class');
            expect(typeof icon.name).toBe('string');
            expect(typeof icon.class).toBe('string');
        });
    });

    it('should have all icons with fa-solid prefix', () => {
        FONT_AWESOME_ICONS.forEach(icon => {
            expect(icon.class).toContain('fa-solid');
        });
    });

    it('should have unique names', () => {
        const names = FONT_AWESOME_ICONS.map(icon => icon.name);
        const uniqueNames = new Set(names);
        expect(names.length).toBe(uniqueNames.size);
    });

    it('should have unique classes', () => {
        const classes = FONT_AWESOME_ICONS.map(icon => icon.class);
        const uniqueClasses = new Set(classes);
        expect(classes.length).toBe(uniqueClasses.size);
    });

    it('should contain common icons', () => {
        const names = FONT_AWESOME_ICONS.map(icon => icon.name);
        expect(names).toContain('folder');
        expect(names).toContain('file');
        expect(names).toContain('image');
        expect(names).toContain('user');
        expect(names).toContain('heart');
    });

    it('should have valid FontAwesome class format', () => {
        FONT_AWESOME_ICONS.forEach(icon => {
            expect(icon.class).toMatch(/^fa-solid fa-[\w-]+$/);
        });
    });

    it('should have non-empty names', () => {
        FONT_AWESOME_ICONS.forEach(icon => {
            expect(icon.name.length).toBeGreaterThan(0);
        });
    });

    it('should have lowercase names', () => {
        FONT_AWESOME_ICONS.forEach(icon => {
            expect(icon.name).toBe(icon.name.toLowerCase());
        });
    });

    it('should have at least 40 icons', () => {
        expect(FONT_AWESOME_ICONS.length).toBeGreaterThanOrEqual(40);
    });
});
