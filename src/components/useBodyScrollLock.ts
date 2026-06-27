import { useEffect } from 'react';

/**
 * M5: blokada scrolla `body` na czas otwartego modala — bez niej po dojechaniu
 * do końca przewijalnej zawartości modala scroll „przelewał się" na stronę pod
 * spodem (scroll chaining, szczególnie dotkliwe na telefonie). Para z klasą
 * `overscroll-contain` na przewijalnym kontenerze modala.
 *
 * Restauruje poprzednią wartość (modale potrafią się zagnieżdżać — np.
 * ConfirmDialog nad BookModalem).
 */
export function useBodyScrollLock(active: boolean = true) {
  useEffect(() => {
    if (!active) return;
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    // overscroll-behavior: none blokuje pull-to-refresh na Android Chrome
    // (overflow: hidden sam w sobie tego nie robi — to browser UI feature)
    document.body.style.overscrollBehavior = 'none';
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.overscrollBehavior = prevOverscroll;
    };
  }, [active]);
}
