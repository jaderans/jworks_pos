export type ThemeMode = 'auto' | 'light' | 'dark';

const KEY = 'jwpos-theme';

export function getTheme(): ThemeMode {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  const dark = mode === 'dark' || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#161312' : '#F2F5F5');
}

export function setTheme(mode: ThemeMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* private mode: theme just won't persist */
  }
  applyTheme(mode);
}
