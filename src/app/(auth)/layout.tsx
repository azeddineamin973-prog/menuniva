import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { LanguageCookieSwitcher } from '@/components/language-cookie-switcher';
import { getMessages } from '@/i18n';
import { getRequestLang } from '@/server/request-lang';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const lang = await getRequestLang();
  const m = getMessages(lang);
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,520px)]">
      <aside className="relative hidden overflow-hidden bg-graphite p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <span className="rounded-2xl bg-white/5 p-1">
            <Logo compact />
          </span>
          <span className="text-lg font-semibold">
            Menu<span className="text-lime">Niva</span>
          </span>
        </Link>
        <div>
          <p className="max-w-md text-4xl leading-tight font-semibold tracking-tight">{m.common.appTagline}</p>
          <p className="mt-4 max-w-md text-white/60">
            QR table ordering · Takeaway · Restaurant delivery · Kitchen &amp; café displays · Reservations · Private feedback
          </p>
        </div>
        <div aria-hidden className="absolute -end-24 -bottom-24 h-80 w-80 rounded-full bg-lime/10 blur-3xl" />
        <p className="text-sm text-white/40">© MenuNiva</p>
      </aside>
      <main className="flex flex-col px-6 py-8 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="lg:invisible">
            <Logo />
          </Link>
          <LanguageCookieSwitcher current={lang} />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
      </main>
    </div>
  );
}
