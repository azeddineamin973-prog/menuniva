'use client';

/**
 * Last-resort error screen, used only when the root layout itself fails (the page styles may not
 * be loaded then, hence the inline styles). Ordinary page errors use app/error.tsx. The error is
 * recorded on the server (ErrorLog); the visitor sees only a reference number.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', background: '#f6f7f5', color: '#16181b' }}>
        <main style={{ maxWidth: 420, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: '#5c636b' }}>Please try again. If it keeps happening, contact support{error.digest ? ` and quote reference ${error.digest}` : ''}.</p>
          <p style={{ fontSize: 14, color: '#5c636b' }} lang="pt">
            Ocorreu um erro. Tente novamente.
          </p>
          <button type="button" onClick={reset} style={{ marginTop: 24, padding: '10px 16px', borderRadius: 12, border: 0, background: '#16181b', color: '#fff', fontSize: 14, fontWeight: 500 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
