'use strict';
// Only the reflection follows the pointer. Controls stay still and keep their hit areas.
(() => {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = matchMedia('(hover: hover) and (pointer: fine)');
  const selector = '.search, .focus-card, .shortcut-icon, .top-actions, #theme-next, dialog';
  let frame = 0;
  let previous = null;
  let pending = null;
  function clear() {
    if (previous) {
      previous.style.removeProperty('--glass-x');
      previous.style.removeProperty('--glass-y');
      previous = null;
    }
  }
  function paint() {
    frame = 0;
    if (!pending || motion.matches || !pointer.matches) { clear(); return; }
    const { surface, x, y } = pending;
    if (previous !== surface) clear();
    if (!surface?.isConnected) return;
    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    surface.style.setProperty('--glass-x', `${Math.max(0, Math.min(100, (x - rect.left) / rect.width * 100))}%`);
    surface.style.setProperty('--glass-y', `${Math.max(0, Math.min(100, (y - rect.top) / rect.height * 100))}%`);
    previous = surface;
  }
  document.addEventListener('pointermove', event => {
    if (motion.matches || !pointer.matches || event.pointerType === 'touch') return;
    const surface = event.target instanceof Element ? event.target.closest(selector) : null;
    pending = surface ? { surface, x: event.clientX, y: event.clientY } : null;
    if (!frame) frame = requestAnimationFrame(paint);
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { pending = null; clear(); });
  window.addEventListener('blur', () => { pending = null; clear(); });
  motion.addEventListener('change', () => { pending = null; clear(); });
})();
