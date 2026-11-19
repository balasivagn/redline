import { describe, expect, it } from 'vitest';
import { CURSOR_STYLE_ID, removeStrayNodes } from './cleanup';

describe('removeStrayNodes', () => {
  it('removes the crosshair style and leftover shadow hosts, and is idempotent', () => {
    const style = document.createElement('style');
    style.id = CURSOR_STYLE_ID;
    document.head.appendChild(style);
    document.body.appendChild(document.createElement('redline-ui'));
    document.body.appendChild(document.createElement('div'));
    expect(removeStrayNodes()).toBe(2);
    expect(document.getElementById(CURSOR_STYLE_ID)).toBeNull();
    expect(document.querySelector('redline-ui')).toBeNull();
    expect(document.body.children.length).toBe(1);
    expect(removeStrayNodes()).toBe(0);
  });
});
