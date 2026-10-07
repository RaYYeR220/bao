'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { countdownText } from '@/lib/countdown';

/**
 * Ticks down to `target` (unix seconds). The server renders the first frame (`initial`); when the
 * time is up the page asks the server again, so a rain turns live and a packet turns expired
 * without a reload.
 */
export function Countdown({ target, initial, label, done }: { target: number; initial: string; label: string; done: string }) {
  const router = useRouter();
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    let asked = 0;
    const tick = () => {
      const seconds = target - Math.floor(Date.now() / 1000);
      setLeft(seconds);
      // once at zero, then every five seconds for half a minute in case the clocks disagree
      if (seconds <= 0 && seconds % 5 === 0 && asked < 6) {
        asked++;
        router.refresh();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target, router]);
  const over = left !== null && left <= 0;
  return (
    <p className="countdown" role="timer">
      <span className="countdown__value">{left === null ? initial : countdownText(left)}</span>
      <span className="countdown__label">{over ? done : label}</span>
    </p>
  );
}
