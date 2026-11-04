'use client';

import { createContext, useContext } from 'react';
import en, { type UiText } from '@/i18n/ui/en';

/**
 * Shared interface words (Save, Cancel, form errors, opening hours…) in the language of the page.
 * The root layout provides the visitor's language and the dashboard layout the signed-in person's
 * language; only that one dictionary is sent to the browser. English when no provider is found.
 */
const UiTextContext = createContext<UiText>(en);

export function UiTextProvider({ text, children }: { text: UiText; children: React.ReactNode }) {
  return <UiTextContext.Provider value={text}>{children}</UiTextContext.Provider>;
}

export function useUiText(): UiText {
  return useContext(UiTextContext);
}
