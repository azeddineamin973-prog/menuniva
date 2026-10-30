import 'server-only';
import { redirect } from 'next/navigation';
import type { ModuleKey } from '@/lib/modules';
import { hasModule } from './modules';
// Kept apart from ./modules so services (also used by CLI scripts) never import Next.js.
/** Dashboard page gate: sections outside the tenant's modules explain why instead of failing. */
export async function requireModulePage(ctx: { org: { id: string; slug: string } }, module: ModuleKey) {
  if (!(await hasModule(ctx.org.id, module))) redirect(`/dashboard/${ctx.org.slug}/unavailable?m=${module}`);
}
