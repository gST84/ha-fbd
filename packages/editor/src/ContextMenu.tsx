import { useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem { label: string; hint?: string; disabled?: boolean; danger?: boolean; separator?: boolean; onClick?(): void }

/** Right-click menu, positioned at the mouse and kept inside the window. Closes on Escape, scroll, or any click elsewhere. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Listeners are registered ONCE. If they were re-registered whenever the parent re-renders (new onClose identity), a key press
  // handled by another global listener could trigger that re-render in the middle of the dispatch and this menu would miss the event.
  const close = useRef(onClose);
  close.current = onClose;
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
  }, [x, y]);
  // layout effect: listeners must exist the moment the menu is visible (a key pressed right after opening must close it)
  useLayoutEffect(() => {
    const onClose = () => close.current();
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    window.addEventListener('wheel', onClose, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose); window.removeEventListener('resize', onClose); window.removeEventListener('wheel', onClose);
    };
  }, []);
  return (
    <div ref={ref} className="ctx-menu" data-testid="ctx-menu" style={pos} onContextMenu={e => e.preventDefault()}>
      {items.map((it, i) => it.separator
        ? <div key={i} className="ctx-sep" />
        : <button key={i} disabled={it.disabled} className={it.danger ? 'danger' : undefined} data-item={it.label}
            onClick={() => { onClose(); it.onClick?.(); }}>
            <span>{it.label}</span>{it.hint && <kbd>{it.hint}</kbd>}
          </button>)}
    </div>
  );
}
