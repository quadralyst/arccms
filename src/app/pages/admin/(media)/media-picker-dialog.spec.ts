import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { MEDIA_PICKER_DIALOG_SIZE, mediaPickerDialogConfig } from './media-picker-dialog';

/** Every .ts file under src, skipping specs. */
function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
    });
}

describe('mediaPickerDialogConfig', () => {
    it('never makes the dialog wider than the screen, so it fits a phone', () => {
        const config = mediaPickerDialogConfig({ isDialogOpen: true });
        expect(config.maxWidth).toBe('100vw');
        // A min width would beat the max width; at 375px wide, 134vh was about 1088px.
        expect(config.minWidth).toBeUndefined();
        expect(config.width).toBe('134vh');
        expect(config.maxHeight).toBe('90vh');
    });

    it("keeps the picker's panel class, animations and close behaviour, and passes the data through", () => {
        const data = { isDialogOpen: true, allowFiles: true, initialTab: 'files', multiple: true };
        const config = mediaPickerDialogConfig(data);
        expect(config).toMatchObject({
            ...MEDIA_PICKER_DIALOG_SIZE,
            panelClass: 'common-dialog-box',
            disableClose: true,
            enterAnimationDuration: '450ms',
            exitAnimationDuration: '300ms',
        });
        expect(config.data).toBe(data);
    });

    it('is how every caller opens the Media Manager as a dialog', () => {
        const src = resolve(__dirname, '../../../..');
        const callers = sourceFiles(src).filter((file) => readFileSync(file, 'utf8').includes('open(MediaManagerComponent'));
        expect(callers.length).toBeGreaterThan(0);
        for (const file of callers) {
            const text = readFileSync(file, 'utf8');
            const opens = text.match(/open\(MediaManagerComponent,\s*[^\n]*/g) ?? [];
            for (const open of opens) expect(open, file).toMatch(/open\(MediaManagerComponent,\s*mediaPickerDialogConfig\(/);
        }
    });
});
