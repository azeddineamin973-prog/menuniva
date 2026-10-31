import { Icon } from '@/components/ui/icons';

/** Shown on guest pages opened in draft preview by a member of the restaurant. */
export function PreviewBanner() {
  return (
    <div className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-amber-300 px-4 py-2 text-center text-[13px] font-medium text-amber-950 shadow-sm" data-testid="preview-banner">
      <Icon name="eye" className="size-4 shrink-0" />
      Draft preview — not published. Only your team can see this page.
    </div>
  );
}
