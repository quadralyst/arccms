import { describe, expect, it } from 'vitest';
import { PdfPickerMemory } from './pdf-picker-memory.service';

describe('PdfPickerMemory (PI-D7, PI-D8)', () => {
    it('remembers the place', () => {
        const memory = new PdfPickerMemory();
        expect(memory.place()).toBeNull();
        memory.remember({ key: 'f1', fileId: 'f1', title: 'Brochure', page: 3, zoom: 2 });
        expect(memory.place()).toEqual({ key: 'f1', fileId: 'f1', title: 'Brochure', page: 3, zoom: 2 });
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

    it('carries the place of a PDF from the computer over to its id once kept', () => {
        const memory = new PdfPickerMemory();
        memory.remember({ key: 'local:a', title: 'A', page: 2, zoom: 1 });
        memory.rekey('other', 'f8');
        expect(memory.place()?.key).toBe('local:a');
        memory.rekey('local:a', 'f9');
        expect(memory.place()).toEqual({ key: 'f9', fileId: 'f9', title: 'A', page: 2, zoom: 1 });
    });

    it('forgets a PDF that is gone', () => {
        const memory = new PdfPickerMemory();
        memory.remember({ key: 'f1', fileId: 'f1', title: 'A', page: 1, zoom: 1 });
        memory.chose(true);
        memory.forget('f1');
        expect(memory.place()).toBeNull();
        expect(memory.lastChoiceFromPdf()).toBe(false);
    });
});
