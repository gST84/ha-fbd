import { setThemeMode, useThemeMode, type ThemeMode } from './theme';

export function ThemeSelect() {
  const mode = useThemeMode();
  return (
    <select className="theme-select" aria-label="Theme" data-testid="theme-select" value={mode}
      title="Light or dark. Auto follows the Home Assistant setting (or your system when opened on its own)."
      onChange={e => setThemeMode(e.target.value as ThemeMode)}>
      <option value="auto">◐ Auto (HA)</option>
      <option value="light">☀ Light</option>
      <option value="dark">☾ Dark</option>
    </select>
  );
}
