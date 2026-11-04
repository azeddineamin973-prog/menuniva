'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

/** `?focus=<element id>`: set by the attention links (e.g. `order-…`, `ticket-…`, `task-…`). */
export function useFocusParam() {
  return useSearchParams().get('focus');
}

/**
 * Once the element with id `focus` is on screen (`ready`: the board has its data), scrolls it to
 * the middle and marks it with `data-focused` for a few seconds, so the person sees which card
 * the link meant. Only presentation: nothing about the item changes.
 */
export function useScrollToFocus(focus: string | null, ready: boolean) {
  useEffect(() => {
    if (!focus || !ready) return;
    const el = document.getElementById(focus);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.setAttribute('data-focused', 'true');
    const t = setTimeout(() => el.removeAttribute('data-focused'), 6000);
    return () => clearTimeout(t);
  }, [focus, ready]);
}
