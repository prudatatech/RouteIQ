import { describe, expect, it } from 'vitest';
import { describeEventWithNotes } from '../src/services/cargo/custody.service';

describe('describeEventWithNotes (the case timeline)', () => {
  it('says a split once: its notes are its description', () => {
    const notes = 'Lot B: 25 of the 100 pieces of RTX-74130BD8 (one lot per drop)';
    expect(describeEventWithNotes({ kind: 'split', notes })).toBe(notes);
  });
  it('adds the notes of other events after the description', () => {
    expect(describeEventWithNotes({ kind: 'pickup', pieces: 4, notes: 'Door was locked' })).toBe('Picked up, 4 pieces. Door was locked');
    expect(describeEventWithNotes({ kind: 'pickup', pieces: 1 })).toBe('Picked up, 1 piece');
  });
});
