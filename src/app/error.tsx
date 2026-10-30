'use client';

/** Shown when a page fails on the server. The error itself is recorded server-side (ErrorLog). */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">Please try again. If it keeps happening, contact support{error.digest ? ` and quote reference ${error.digest}` : ''}.</p>
      <p className="mt-1 text-sm text-muted" lang="pt">Ocorreu um erro. Tente novamente.</p>
      <button type="button" onClick={reset} className="mt-6 rounded-xl bg-graphite px-4 py-2 text-sm font-medium text-white">Try again</button>
    </main>
  );
}
