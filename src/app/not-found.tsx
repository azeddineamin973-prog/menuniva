import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { buttonClass } from '@/components/ui';

/** Any address that does not exist (or a page the visitor may not see): plain words, a way out. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 py-16 text-center">
      <Logo className="mb-6" />
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted">This address does not exist, or the page is no longer available.</p>
      <p className="mt-1 text-sm text-muted" lang="pt">
        Esta página não existe ou já não está disponível.
      </p>
      <Link href="/" className={buttonClass('secondary', 'md', 'mt-6')}>
        Go to MenuNiva
      </Link>
    </main>
  );
}
