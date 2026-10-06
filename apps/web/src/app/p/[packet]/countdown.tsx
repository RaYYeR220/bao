'use client';

import { useEffect, useState } from 'react';

function format(seconds: number) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h >= 48) return `${Math.floor(h / 24)} days`;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Ticks down to `target` (unix seconds); the server renders the first frame. */
export function Countdown({ label, target, initial }: { label: string; target: number; initial: string }) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    const tick = () => {
      const left = target - Math.floor(Date.now() / 1000);
      setText(left > 0 ? `${label} ${format(left)}` : 'Refresh to see the latest');
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [label, target]);
  return <span suppressHydrationWarning>{text}</span>;
}
