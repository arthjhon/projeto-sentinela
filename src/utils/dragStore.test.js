import { describe, it, expect, vi } from 'vitest';
import { createDragStore } from './dragStore';

describe('createDragStore', () => {
  it('starts idle', () => {
    expect(createDragStore().getSnapshot()).toBeNull();
  });
  it('start/move update the snapshot and notify; move of another chart is ignored', () => {
    const s = createDragStore();
    const fn = vi.fn();
    s.subscribe(fn);
    s.start('turbidez', 10);
    expect(s.getSnapshot()).toEqual({ id: 'turbidez', a: 10, b: null });
    s.move('turbidez', 20);
    expect(s.getSnapshot()).toEqual({ id: 'turbidez', a: 10, b: 20 });
    const antes = s.getSnapshot();
    s.move('chuva', 99);
    expect(s.getSnapshot()).toBe(antes);
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('end returns the ordered range when the mouse moved, and resets', () => {
    const s = createDragStore();
    s.start('x', 50);
    s.move('x', 30);
    expect(s.end()).toEqual([30, 50]);
    expect(s.getSnapshot()).toBeNull();
  });
  it('end without movement (or equal points) returns null', () => {
    const s = createDragStore();
    s.start('x', 5);
    expect(s.end()).toBeNull();
    s.start('x', 5);
    s.move('x', 5);
    expect(s.end()).toBeNull();
  });
  it('cancel resets without a range and does not notify when idle', () => {
    const s = createDragStore();
    const fn = vi.fn();
    s.subscribe(fn);
    s.cancel();
    expect(fn).not.toHaveBeenCalled();
    s.start('x', 1);
    s.cancel();
    expect(s.getSnapshot()).toBeNull();
  });
  it('unsubscribe stops notifications', () => {
    const s = createDragStore();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    off();
    s.start('x', 1);
    expect(fn).not.toHaveBeenCalled();
  });
});
