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
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}
