import { useEffect, useState } from 'react';

/**
 * A second monitor for the customer screen. Chrome and Edge (100 and newer)
 * can tell when the desktop spans more than one screen and, once the person
 * allows "window management", place a window on the other one. Elsewhere the
 * screen opens as a normal window to drag across.
 */

interface ScreenDetailed {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  isPrimary: boolean;
}
interface ScreenDetails {
  screens: ScreenDetailed[];
  currentScreen: ScreenDetailed;
}
type WithScreens = Window & { getScreenDetails?: () => Promise<ScreenDetails> };
type ExtendedScreen = Screen & { isExtended?: boolean; addEventListener?: (type: 'change', fn: () => void) => void; removeEventListener?: (type: 'change', fn: () => void) => void };

/** True while the desktop spans more than one monitor (Chrome and Edge only; elsewhere always false). */
export function useSecondScreen(): boolean {
  const [extended, setExtended] = useState(() => !!(window.screen as ExtendedScreen).isExtended);
  useEffect(() => {
    const s = window.screen as ExtendedScreen;
    const onChange = () => setExtended(!!s.isExtended);
    s.addEventListener?.('change', onChange);
    return () => s.removeEventListener?.('change', onChange);
  }, []);
  return extended;
}

const WINDOW = 'jwpos-customer-screen';
let opened: Window | null = null;

/**
 * Open the customer screen, or bring it forward. It opens first (a click can
 * open one window), then moves to the other monitor when there is one.
 */
export async function openCustomerScreen(): Promise<'moved' | 'opened' | 'blocked'> {
  const url = `${window.location.pathname}${window.location.search}#/display`;
  if (opened && !opened.closed) {
    opened.focus();
  } else {
    opened = window.open(url, WINDOW, 'popup,width=1280,height=720');
    if (!opened) return 'blocked';
  }
  const w = opened;
  const get = (window as WithScreens).getScreenDetails;
  if (!get || !(window.screen as ExtendedScreen).isExtended) return 'opened';
  try {
    const details = await get.call(window);
    const other = details.screens.find((s) => s !== details.currentScreen && !s.isPrimary) ?? details.screens.find((s) => s !== details.currentScreen);
    if (!other) return 'opened';
    w.moveTo(other.availLeft, other.availTop);
    w.resizeTo(other.availWidth, other.availHeight);
    return 'moved';
  } catch {
    // Window management was refused: the window stays where it opened.
    return 'opened';
  }
}
