'use client';
/** The shared qr.js renders [data-qr] boxes once; after React hydrates it may have run too early, so ask it again until the box is filled. */
import { useEffect } from 'react';

type Win = Window & { NextMON?: { renderQR?: (root?: ParentNode) => void } };

export default function QrKick() {
  useEffect(() => {
    let n = 0;
    const tick = () => {
      (window as Win).NextMON?.renderQR?.();
      const box = document.querySelector<HTMLElement>('[data-qr]');
      if ((!box || !box.dataset.done || box.innerHTML === '') && ++n < 40) {
        if (box) delete box.dataset.done;
        setTimeout(tick, 100);
      }
    };
    tick();
  }, []);
  return null;
}
