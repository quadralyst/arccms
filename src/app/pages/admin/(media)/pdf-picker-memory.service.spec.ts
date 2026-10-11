import { describe, expect, it } from 'vitest';
import { PdfPickerMemory } from './pdf-picker-memory.service';

describe('PdfPickerMemory (PI-D7, PI-D8)', () => {
    const part = { x: 1, y: 2, width: 3, height: 4 };

    it('remembers the place and the parts taken from each page', () => {
        const memory = new PdfPickerMemory();
        expect(memory.place()).toBeNull();
        memory.remember({ key: 'f1', fileId: 'f1', title: 'Brochure', page: 3, zoom: 2 });
        memory.markTaken('f1', 3, part);
        expect(memory.place()).toEqual({ key: 'f1', fileId: 'f1', title: 'Brochure', page: 3, zoom: 2 });
        expect(memory.takenOn('f1', 3)).toEqual([part]);
        expect(memory.takenOn('f1', 4)).toEqual([]);
    });

    it('opens the next picker on the PDF only when the last image came from one that is in Files', () => {
        const memory = new PdfPickerMemory();
        memory.remember({ key: 'local:a', title: 'A', page: 1, zoom: 1 });
        memory.chose(true);
        expect(memory.lastChoiceFromPdf()).toBe(false);
        memory.rekey('local:a', 'f9');
        expect(memory.lastChoiceFromPdf()).toBe(true);
        memory.chose(false);
        expect(memory.lastChoiceFromPdf()).toBe(false);
    });

    it('carries a PDF from the computer over to its id once kept, joining what was there', () => {
        const memory = new PdfPickerMemory();
        memory.markTaken('local:a', 2, part);
        memory.markTaken('f9', 2, { ...part, x: 9 });
        memory.rekey('local:a', 'f9');
        expect(memory.takenOn('f9', 2)).toHaveLength(2);
        expect(memory.takenOn('local:a', 2)).toEqual([]);
    });

    it('forgets a PDF that is gone', () => {
        const memory = new PdfPickerMemory();
        memory.remember({ key: 'f1', fileId: 'f1', title: 'A', page: 1, zoom: 1 });
        memory.markTaken('f1', 1, part);
        memory.chose(true);
        memory.forget('f1');
        expect(memory.place()).toBeNull();
        expect(memory.takenOn('f1', 1)).toEqual([]);
        expect(memory.lastChoiceFromPdf()).toBe(false);
    });
});
