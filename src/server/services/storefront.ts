import 'server-only';
import type { LanguageCode } from '@/generated/prisma/enums';
import { getCurrentUser } from '../auth/session';
import { db } from '../db';
import { getRequestLang } from '../request-lang';

/** Guest language: their choice (cookie) if the restaurant enabled it, else the restaurant default. */
export async function resolveGuestLanguage(org: { defaultLanguage: LanguageCode; enabledLanguages: LanguageCode[] }, override?: string | null): Promise<LanguageCode> {
  if (override && (org.enabledLanguages as string[]).includes(override)) return override as LanguageCode;
  const chosen = await getRequestLang(org.defaultLanguage);
  return org.enabledLanguages.includes(chosen) ? chosen : org.defaultLanguage;
}

export async function getStorefrontOrg(slug: string) {
  return db.restaurantOrganization.findUnique({
    where: { slug },
    include: { branding: true, settings: true, locations: { where: { isPublished: true }, orderBy: { createdAt: 'asc' }, include: { reviewSettings: true } } },
  });
}

export function allergyNoticeFor(settings: { allergyNotice: unknown } | null, lang: LanguageCode, fallback: string): string {
  const custom = (settings?.allergyNotice ?? {}) as Partial<Record<LanguageCode, string>>;
  return custom[lang]?.trim() || fallback;
}

/**
 * Draft preview: a signed-in active member of the restaurant may open its guest pages with
 * `?preview=1` before they are published. Everyone else gets the normal public behaviour, so a
 * shared link or QR code never reveals an unpublished menu. The session cookie is the only key.
 */
export async function canPreviewOrg(organizationId: string, requested: boolean) {
  if (!requested) return false;
  const user = await getCurrentUser();
  if (!user) return false;
  return !!(await db.restaurantMembership.findFirst({ where: { userId: user.id, organizationId, status: 'ACTIVE' }, select: { id: true } }));
}

/** Query string that keeps preview mode and an explicit language across guest pages. */
export function guestQuery(extra: Record<string, string | null | undefined>, keep: { preview?: boolean; lang?: string | null }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  if (keep.preview) q.set('preview', '1');
  if (keep.lang) q.set('lang', keep.lang);
  const s = q.toString();
  return s ? `?${s}` : '';
}
