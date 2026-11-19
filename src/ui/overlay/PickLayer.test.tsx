import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostContext } from './context';
import { PickLayer } from './PickLayer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setup() {
  const host = document.createElement('div');
  const mount = document.createElement('div');
  document.body.append(host, mount);
  const root = createRoot(mount);
  const onPick = vi.fn();
  act(() => root.render(<HostContext.Provider value={host}><PickLayer mode="area" onPick={onPick} /></HostContext.Provider>));
  const fire = (type: string, init: PointerEventInit = {}, target: EventTarget = window) =>
    act(() => { target.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, ...init })); });
  return { host, mount, root, onPick, fire };
}
const box = () => document.querySelector('.border-dashed');

afterEach(() => { document.body.innerHTML = ''; document.head.innerHTML = ''; });

describe('PickLayer area drag cleanup', () => {
  it('draws the box while dragging and removes it on a normal release', () => {
    const t = setup();
    t.fire('pointerdown', { clientX: 10, clientY: 10, button: 0, buttons: 1 });
    t.fire('pointermove', { clientX: 200, clientY: 150, buttons: 1 });
    expect(box()).not.toBeNull();
    t.fire('pointerup', { clientX: 200, clientY: 150, button: 0 });
    expect(box()).toBeNull();
    expect(t.onPick).toHaveBeenCalledTimes(1);
    act(() => t.root.unmount());
  });

  it('drops a stuck box when the release was lost (move with no buttons)', () => {
    const t = setup();
    t.fire('pointerdown', { clientX: 10, clientY: 10, button: 0, buttons: 1 });
    t.fire('pointermove', { clientX: 200, clientY: 150, buttons: 1 });
    expect(box()).not.toBeNull();
    t.fire('pointermove', { clientX: 220, clientY: 160, buttons: 0 });
    expect(box()).toBeNull();
    act(() => t.root.unmount());
  });

  it('drops the box on pointercancel and on window blur', () => {
    const t = setup();
    for (const end of ['pointercancel', 'blur']) {
      t.fire('pointerdown', { clientX: 10, clientY: 10, button: 0, buttons: 1 });
      t.fire('pointermove', { clientX: 200, clientY: 150, buttons: 1 });
      expect(box()).not.toBeNull();
      act(() => { window.dispatchEvent(new Event(end)); });
      expect(box()).toBeNull();
    }
    act(() => t.root.unmount());
  });

  it('removes the crosshair style and the box when unmounted mid-drag', () => {
    const t = setup();
    t.fire('pointerdown', { clientX: 10, clientY: 10, button: 0, buttons: 1 });
    t.fire('pointermove', { clientX: 200, clientY: 150, buttons: 1 });
    expect(document.getElementById('redline-cursor-style')).not.toBeNull();
    act(() => t.root.unmount());
    expect(document.getElementById('redline-cursor-style')).toBeNull();
    expect(box()).toBeNull();
  });
});
