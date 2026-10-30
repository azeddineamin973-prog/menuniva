/** "Casa de Marrocos" → "casa-de-marrocos". ASCII only, max 48 chars. */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/g, '') || 'restaurant'
  );
}

export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'dashboard', 'login', 'signup', 'setup', 'onboarding', 'r', 't', 'o', 'static', 'menuniva', 'www', 'help', 'support',
]);
