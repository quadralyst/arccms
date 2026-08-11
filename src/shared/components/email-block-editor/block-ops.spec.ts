import { describe, it, expect } from 'vitest';
import { createBlock, moveBlock, removeBlock, appendTag, newBlockId } from './block-ops';

describe('block-ops', () => {
    it('createBlock returns typed defaults with a unique id', () => {
        const h = createBlock('heading') as any;
        expect(h.type).toBe('heading');
        expect(h.text).toBeTruthy();
        expect(h.id).toMatch(/^blk_/);
        const btn = createBlock('button') as any;
        expect(btn.href).toBe('https://');
    });

    it('newBlockId is unique across calls', () => {
        expect(newBlockId()).not.toBe(newBlockId());
    });

    it('moveBlock swaps adjacent items', () => {
        const a = createBlock('heading');
        const b = createBlock('paragraph');
        const moved = moveBlock([a, b], 0, 1);
        expect(moved[0]).toBe(b);
        expect(moved[1]).toBe(a);
    });

    it('moveBlock is a no-op at boundaries', () => {
        const a = createBlock('heading');
        const b = createBlock('paragraph');
        expect(moveBlock([a, b], 0, -1)).toEqual([a, b]);
        expect(moveBlock([a, b], 1, 1)).toEqual([a, b]);
    });

    it('removeBlock removes by index', () => {
        const a = createBlock('heading');
        const b = createBlock('paragraph');
        expect(removeBlock([a, b], 0)).toEqual([b]);
    });

    it('appendTag inserts with a separating space', () => {
        expect(appendTag('Hi', '##NAME##')).toBe('Hi ##NAME##');
        expect(appendTag('Hi ', '##NAME##')).toBe('Hi ##NAME##');
        expect(appendTag('', '##NAME##')).toBe('##NAME##');
    });
});
