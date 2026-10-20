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

    it("names the dialog for screen readers with the caller's title, and only then", () => {
        expect(mediaPickerDialogConfig({ isDialogOpen: true, title: ' Hero image ' }).ariaLabel).toBe('Hero image');
        expect(mediaPickerDialogConfig({ isDialogOpen: true }).ariaLabel).toBeUndefined();
        expect(mediaPickerDialogConfig({ isDialogOpen: true, title: '  ' }).ariaLabel).toBeUndefined();
    });

    it("is given a title by every core caller, so the admin knows what the image is for (an app's own pickers may leave it out)", () => {
        const src = resolve(__dirname, '../../../..');
        const custom = join(src, 'custom');
        const calls = sourceFiles(src)
            // The title is optional: an app's custom space keeps working without it.
            .filter((file) => !file.endsWith('media-picker-dialog.ts') && !file.startsWith(custom + '/'))
            .flatMap((file) => {
                const text = readFileSync(file, 'utf8');
                const found: { file: string; args: string }[] = [];
                let at = text.indexOf('mediaPickerDialogConfig(');
                while (at !== -1) {
                    // The call's arguments, up to the bracket that closes it.
                    let depth = 0;
                    let end = at + 'mediaPickerDialogConfig'.length;
                    for (; end < text.length; end++) {
                        if (text[end] === '(') depth++;
                        if (text[end] === ')' && --depth === 0) break;
                    }
                    found.push({ file, args: text.slice(at, end + 1) });
                    at = text.indexOf('mediaPickerDialogConfig(', end);
                }
                return found;
            })
            // The import line names it without calling it.
            .filter((call) => call.args.includes('{'));
        expect(calls.length).toBeGreaterThanOrEqual(10);
        for (const call of calls) expect(call.args, call.file).toMatch(/\btitle\b/);
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
