import { ButtonLink, buttonClass } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { BrowserFrame, GuestMenuScreen, LiveBoardMock, OrderToast, PhoneFrame, StationTicketFloat } from './mockups';
import { Container, ctaSize, Perks, type Cta } from './ui';

export function Hero({ cta, perks }: { cta: Cta; perks: string[] }) {
  return (
    <section aria-labelledby="hero-title" className="relative isolate pt-12 pb-16 sm:pt-20 sm:pb-24">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="mn-grid-lines mn-mask-top absolute inset-0" />
        <div className="absolute start-1/2 -top-48 h-[36rem] w-[64rem] max-w-none -translate-x-1/2 bg-[radial-gradient(closest-side,rgb(185_255_54/0.32),transparent)] dark:bg-[radial-gradient(closest-side,rgb(185_255_54/0.12),transparent)]" />
      </div>

      <Container className="text-center">
        <a
          href="#one-menu"
          className="group inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-surface/80 py-1 ps-1 pe-3 text-[13px] text-ink-2 shadow-xs backdrop-blur transition-colors hover:border-line-strong hover:text-ink"
        >
          <span className="shrink-0 rounded-full bg-lime px-2 py-0.5 text-xs font-semibold text-lime-ink">Import</span>
          <span className="truncate sm:hidden">Your menu from Glovo, Excel or PDF</span>
          <span className="hidden truncate sm:inline">Bring your menu from Glovo, Excel or PDF</span>
          <Icon name="arrowRight" className="size-3.5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
        </a>

        <h1
          id="hero-title"
          className="mx-auto mt-7 max-w-5xl text-[2.4rem] leading-[1.03] font-semibold tracking-[-0.035em] text-balance text-ink min-[400px]:text-5xl sm:text-6xl lg:text-7xl xl:text-[5rem]"
        >
          One Menu. Every Order. <span className="box-decoration-clone rounded-[0.18em] bg-lime px-[0.14em] text-lime-ink">Every Language.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-muted sm:text-xl">
          QR table ordering, takeaway, your own delivery, kitchen displays and reservations in one platform. Guests order in their own language. Your team sees every
          order in one place.
        </p>

        <div className="mt-9 flex flex-col items-stretch justify-center gap-3 min-[400px]:flex-row min-[400px]:items-center">
          <ButtonLink href={cta.href} size="lg" iconEnd="arrowRight" className={ctaSize} data-testid="landing-hero-cta">
            {cta.label}
          </ButtonLink>
          <a href="#how-it-works" className={buttonClass('secondary', 'lg', ctaSize)}>
            See how it works
          </a>
        </div>
        <Perks items={perks} className="mt-7 justify-center" />
      </Container>

      <Container className="mt-14 sm:mt-20">
        <HeroVisual />
      </Container>
    </section>
  );
}

/** Live orders board with the guest's phone in front (tablets and up); the phone alone on phones. */
function HeroVisual() {
  return (
    <div aria-hidden className="relative">
      <div className="pointer-events-none absolute inset-x-[8%] top-[12%] bottom-0 -z-10 rounded-[3rem] bg-lime/25 blur-[90px] dark:bg-lime/10" />

      <div className="relative mx-auto w-full max-w-[272px] md:hidden">
        <div className="animate-rise">
          <PhoneFrame>
            <GuestMenuScreen />
          </PhoneFrame>
        </div>
        <div className="absolute -end-3 -top-7 animate-rise [animation-delay:250ms]">
          <OrderToast className="animate-float" />
        </div>
      </div>

      <div className="relative hidden md:block">
        {/* The phone overlaps only the window's padding (tablets) or its sidebar (desktops). */}
        <div className="ms-[28%] animate-rise lg:ms-[21%]">
          <BrowserFrame title="Live orders · Restaurante Demo">
            <LiveBoardMock />
          </BrowserFrame>
        </div>
        <div className="absolute start-0 -bottom-10 w-[30%] max-w-[270px] animate-rise [animation-delay:150ms] lg:w-[26%]">
          <PhoneFrame>
            <GuestMenuScreen />
          </PhoneFrame>
        </div>
        <div className="absolute start-[16%] -top-7 hidden animate-rise [animation-delay:350ms] lg:block">
          <OrderToast className="animate-float" />
        </div>
        <div className="absolute -end-3 top-[38%] hidden animate-rise [animation-delay:500ms] lg:block xl:-end-8">
          <StationTicketFloat className="animate-float [animation-delay:-3.5s]" />
        </div>
      </div>
    </div>
  );
}
