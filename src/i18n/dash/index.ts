import type { LanguageCode } from '@/generated/prisma/enums';
import ar from './ar';
import en, { type DashText } from './en';
import es from './es';
import fr from './fr';
import pt from './pt';

export type { DashText };
const DASH: Record<LanguageCode, DashText> = { pt, en, fr, ar, es };

/** Staff page text for one language (server components; pass slices to client components as props). */
export function getDashText(lang: LanguageCode): DashText {
  return DASH[lang] ?? en;
}
