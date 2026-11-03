import { createRoot, type Root } from 'react-dom/client';
import { Overlay } from './Overlay';

/** Render the overlay into the shadow container. Returns the React root (unmount on removal). */
export function mountOverlay(container: HTMLElement, host: HTMLElement, onClose: () => void): Root {
  container.style.pointerEvents = 'none'; // only our controls opt back in
  const mount = document.createElement('div');
  mount.className = 'text-base';
  container.appendChild(mount);
  const root = createRoot(mount);
  root.render(<Overlay host={host} onClose={onClose} />);
  return root;
}
