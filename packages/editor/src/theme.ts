import { useSyncExternalStore } from 'react';

/** auto = follow Home Assistant (its profile setting), falling back to the browser / OS preference. */
export type ThemeMode = 'auto' | 'light' | 'dark';
const KEY = 'fbd.theme';

const isDarkCss = (css: string): boolean | null => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
  let rgb: number[] | null = null;
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map(c => c + c).join('') : hex[1];
    rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  } else {
    const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(css);
    if (m) rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return rgb ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 < 0.5 : null;
};

/**
 * Is Home Assistant itself in dark mode?  The add-on page is shown inside HA (same origin through Ingress), so we can read
 * HA's own state: hass.themes.darkMode, or – for custom themes – the luminance of its background colour.
 * Returns null when we are not embedded (or the page is cross-origin).
 */
export function detectHaDark(): boolean | null {
  try {
    if (window.parent === window) return null;
    const doc = window.parent.document;
    const ha = doc.querySelector('home-assistant') as unknown as { hass?: { themes?: { darkMode?: boolean } } } | null;
    const dm = ha?.hass?.themes?.darkMode;
    if (typeof dm === 'boolean') return dm;
    const bg = getComputedStyle(doc.documentElement).getPropertyValue('--primary-background-color');
    return bg ? isDarkCss(bg) : null;
  } catch { return null; }
}

export function effectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'auto') return mode;
  const ha = detectHaDark();
  if (ha !== null) return ha ? 'dark' : 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readMode(): ThemeMode {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch { return 'auto'; }
}

let mode: ThemeMode = readMode();
const listeners = new Set<() => void>();
const apply = () => {
  const el = document.documentElement;
  el.dataset.theme = effectiveTheme(mode);
  el.dataset.themeMode = mode;
};

export function setThemeMode(next: ThemeMode): void {
  mode = next;
  try { localStorage.setItem(KEY, next); } catch { /* storage unavailable */ }
  apply();
  listeners.forEach(l => l());
}

/** Call once at start-up. In auto mode HA's setting is re-read every 2 s so switching HA's theme is followed live. */
export function initTheme(): void {
  apply();
  setInterval(() => { if (mode === 'auto') apply(); }, 2000);
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (mode === 'auto') apply(); });
}

export const useThemeMode = (): ThemeMode =>
  useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => mode);
