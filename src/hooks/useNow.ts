import { useEffect, useState } from 'react';

/** The current time, updated on each whole step (every second by default) so clocks tick together. */
export function useNow(stepMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let t = 0;
    const schedule = () => {
      t = window.setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, stepMs - (Date.now() % stepMs) + 5);
    };
    schedule();
    return () => window.clearTimeout(t);
  }, [stepMs]);
  return now;
}
