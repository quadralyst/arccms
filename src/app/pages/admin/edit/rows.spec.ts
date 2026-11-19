/**
 * The row bar's changes (specs/visual-editing-spec.md, VE-D32): rows keep their
 * ids, positions are renumbered 1 to n, and nothing given is changed.
 */
import { describe, it, expect } from 'vitest';
import { REPEATER_SCHEMAS, RepeaterLocationSubField, RepeaterMediaSubField } from '../../../../shared/models/repeater.model';
import { insertRowsAfter, moveRow, removeRow, restoreRow, rowsAcross, setRowLocation, setRowMedia, setRowValue } from './rows';

const rows = () => [
    { id: 'b', position: 2, question: 'Two' },
    { id: 'a', position: 1, question: 'One' },
    { id: 'c', position: 3, question: 'Three' },
];
const order = (list: { id: string; position: number }[]) => list.map((r) => `${r.id}${r.position}`).join(' ');

describe('insertRowsAfter', () => {
    it('adds after the row named, in display order, renumbered', () => {
        expect(order(insertRowsAfter(rows(), 'a', [{ id: 'n', position: 0 }]))).toBe('a1 n2 b3 c4');
        expect(order(insertRowsAfter(rows(), 'c', [{ id: 'n', position: 0 }, { id: 'm', position: 0 }]))).toBe('a1 b2 c3 n4 m5');
    });

    it('adds first with no row named, and last after a row no longer there', () => {
        expect(order(insertRowsAfter(rows(), null, [{ id: 'n', position: 0 }]))).toBe('n1 a2 b3 c4');
        expect(order(insertRowsAfter(rows(), 'gone', [{ id: 'n', position: 0 }]))).toBe('a1 b2 c3 n4');
        expect(order(insertRowsAfter([], null, [{ id: 'n', position: 0 }]))).toBe('n1');
    });

    it('never changes the rows it is given', () => {
        const given = rows();
        insertRowsAfter(given, 'a', [{ id: 'n', position: 0 }]);
        expect(given).toEqual(rows());
    });
});

describe('moveRow', () => {
    it('moves a row one place each way, keeping every id', () => {
        expect(order(moveRow(rows(), 'b', -1))).toBe('b1 a2 c3');
        expect(order(moveRow(rows(), 'b', 1))).toBe('a1 c2 b3');
    });

    it('stays put at either end or for a row not there', () => {
        expect(order(moveRow(rows(), 'a', -1))).toBe('a1 b2 c3');
        expect(order(moveRow(rows(), 'c', 1))).toBe('a1 b2 c3');
        expect(order(moveRow(rows(), 'x', 1))).toBe('a1 b2 c3');
    });
});

describe('removeRow and restoreRow', () => {
    it('removes a row and says where it was', () => {
        const { rows: left, removed, index } = removeRow(rows(), 'b');
        expect(order(left)).toBe('a1 c2');
        expect(removed?.id).toBe('b');
        expect(index).toBe(1);
    });

    it('Undo puts it back in its place, keeping changes made meanwhile', () => {
        const { rows: left, removed, index } = removeRow(rows(), 'b');
        const changed = setRowValue(left, 'c', 'question', 'Changed');
        const back = restoreRow(changed, removed!, index);
        expect(order(back)).toBe('a1 b2 c3');
        expect(back.find((r) => r.id === 'c')?.['question']).toBe('Changed');
        expect(back.find((r) => r.id === 'b')?.['question']).toBe('Two');
    });

    it('puts it back once only, and at the end when the list got shorter', () => {
        const { removed } = removeRow(rows(), 'c');
        expect(order(restoreRow(rows(), removed!, 2))).toBe('a1 b2 c3');
        expect(order(restoreRow([{ id: 'a', position: 1 }], removed!, 5))).toBe('a1 c2');
    });

    it('removing a row not there changes nothing', () => {
        expect(removeRow(rows(), 'x').removed).toBeNull();
    });
});

describe('setRowMedia', () => {
    const sub = REPEATER_SCHEMAS['infocard'].subFields[0] as RepeaterMediaSubField;
    const gallery = REPEATER_SCHEMAS['gallery'].subFields[0] as RepeaterMediaSubField;

    it('one visual per row: the choice, the others cleared', () => {
        const withImage = [{ id: 'a', position: 1, image: 'x.jpg', icon: null }];
        const icon = { name: 'star', set: 'bi' };
        expect(setRowMedia(withImage, 'a', sub, { icon })[0]).toEqual({ id: 'a', position: 1, image: '', icon });
        const withVideo = [{ id: 'a', position: 1, image: '', video: 'https://youtu.be/dQw4w9WgXcQ' }];
        expect(setRowMedia(withVideo, 'a', gallery, { image: 'p.jpg' })[0]).toEqual({ id: 'a', position: 1, image: 'p.jpg', video: '' });
    });

    it('{} clears the row\'s picture, and other rows are untouched', () => {
        const list = [{ id: 'a', position: 1, image: 'x.jpg', icon: null }, { id: 'b', position: 2, image: 'y.jpg', icon: null }];
        const out = setRowMedia(list, 'a', sub, {});
        expect(out[0]['image']).toBe('');
        expect(out[1]).toBe(list[1]);
    });
});

describe('setRowLocation (VE-D34)', () => {
    const sub = REPEATER_SCHEMAS['maplocation'].subFields[1] as RepeaterLocationSubField;
    const list = [{ id: 'a', position: 1, label: 'Shop', address: '', lat: null, lng: null, zoom: null }];

    it('writes the address and the point together, as the form\'s row editor does', () => {
        const out = setRowLocation(list, 'a', sub, { address: '1 High St', lat: 51.5, lng: -0.1, zoom: 16 });
        expect(out[0]).toEqual({ id: 'a', position: 1, label: 'Shop', address: '1 High St', lat: 51.5, lng: -0.1, zoom: 16 });
        expect(list[0].address).toBe('');
    });

    it('null clears the address and the point, never the name', () => {
        const placed = setRowLocation(list, 'a', sub, { address: 'x', lat: 1, lng: 2, zoom: 3 });
        expect(setRowLocation(placed, 'a', sub, null)[0]).toEqual({ id: 'a', position: 1, label: 'Shop', address: '', lat: null, lng: null, zoom: null });
    });
});

describe('rowsAcross', () => {
    it('across when the neighbour is on the same line, else up and down', () => {
        expect(rowsAcross({ top: 100, height: 200 }, { top: 102 })).toBe(true);
        expect(rowsAcross({ top: 100, height: 40 }, { top: 150 })).toBe(false);
        expect(rowsAcross({ top: 100, height: 40 }, null)).toBe(false);
    });
});
