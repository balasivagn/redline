import { describe, it, expect } from 'vitest';
import { matchesShortcut } from './settings';
describe('shortcuts', () => { it('matches Alt+Space', () => { expect(matchesShortcut(new KeyboardEvent('keydown', { code: 'Space', key: ' ', altKey: true }), 'Alt+Space')).toBe(true); expect(matchesShortcut(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p' }), 'P')).toBe(true); expect(matchesShortcut(new KeyboardEvent('keydown', { code: 'KeyP', key: 'P', shiftKey: true }), 'P')).toBe(false); }); });
